import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PRACTICE_CODES,
  adminCheckin,
  adminUndoCheckin,
  admitParticipants,
  anonymiseCheckinData,
  checkinStats,
  gateState,
  lookupTicket,
  recordEscalation,
  shortName,
  undoCheckin,
  type LookupResult,
  type ScannerIdentity,
} from "../app/lib/checkin.server";
import { getParticipants, getRegistration, type EventRow } from "../app/lib/db.server";
import { confirmPayment, deleteRegistration, rejectMembership, setMembershipVerified } from "../app/lib/payments.server";
import { registerOnline } from "../app/lib/registration.server";
import { cancelOwnRegistration, updateOwnRegistration } from "../app/lib/self-service.server";
import { T0, input, resetDb, startDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;
let event: EventRow;

// Event day: gate open 07:00 (1 h before start) to 15:30 UTC (1 h after end).
const EVENT_START = "2026-12-05T08:00:00.000Z";
const EVENT_END = "2026-12-05T13:30:00.000Z";
const DOOR = new Date("2026-12-05T08:10:00.000Z");
const at = (isoOrMs: string | number) => new Date(typeof isoOrMs === "string" ? isoOrMs : DOOR.getTime() + isoOrMs);

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  await resetDb(db);
  await db
    .prepare("UPDATE events SET status = 'open', registration_closes_at = ?, starts_at = ?, ends_at = ?, self_add_allowed = 1")
    .bind("2026-11-27T22:59:00.000Z", EVENT_START, EVENT_END)
    .run();
  event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
});

let scannerSeq = 0;
async function addScanner(role: "scanner" | "lead" = "scanner", extra: { email?: string; participantId?: string | null } = {}): Promise<ScannerIdentity> {
  scannerSeq++;
  const email = extra.email ?? `scanner${scannerSeq}@example.org`;
  const row = await db
    .prepare("INSERT INTO scanners (email, name, role, participant_id, added_by, added_at) VALUES (?, ?, ?, ?, 'test', ?) RETURNING id")
    .bind(email, `Petugas ${scannerSeq}`, role, extra.participantId ?? null, T0.toISOString())
    .first<{ id: number }>();
  return { id: row!.id, email, name: `Petugas ${scannerSeq}`, role, participantId: extra.participantId ?? null, deviceLabel: "Safari di iOS" };
}

/** A validated member registration (accepted, QR codes issued). */
async function member(people = 1, overrides: Parameters<typeof input>[0] = {}) {
  const data = input({ people, ...overrides });
  const res = await registerOnline(db, event, data, { now: T0, ignoreWindow: true });
  if (res.kind !== "pending_membership") throw new Error(res.kind);
  expect((await setMembershipVerified(db, res.registrationId, "admin@test", true, T0)).ok).toBe(true);
  const parts = await getParticipants(db, res.registrationId);
  return { id: res.registrationId, email: data.email, parts, codes: parts.map((p) => p.qr_token!) };
}

const lookup = async (s: ScannerIdentity, code: string, now = DOOR) => (await lookupTicket(db, event, s, code, now)) as LookupResult;

describe("verdicts (rules R1-R9)", () => {
  it("green for an accepted member at an open gate, with a short name and no personal data", async () => {
    const s = await addScanner();
    const m = await member(2);
    const res = await lookup(s, m.codes[0]);
    expect(res).toMatchObject({ verdict: "green", reason: null, gate: "open", inside: 0, total: 2 });
    expect(res.person?.name).toBe(shortName(m.parts[0].full_name));
    expect(res.group).toHaveLength(2);
    const json = JSON.stringify(res);
    expect(json).not.toContain(m.email);
    expect(json).not.toContain("+31");
    expect(json).not.toContain(m.parts[0].full_name); // only the short form leaves the server
  });

  it("R1: malformed and unknown codes are red, and logged without the full code", async () => {
    const s = await addScanner();
    expect(await lookup(s, "hello")).toMatchObject({ verdict: "red", reason: "unknown_code" });
    expect(await lookup(s, "0".repeat(26))).toMatchObject({ verdict: "red", reason: "unknown_code" });
    const { results } = await db.prepare("SELECT action, detail FROM checkin_log").all<{ action: string; detail: string }>();
    expect(results.every((r) => r.action === "invalid")).toBe(true);
    expect(results.map((r) => r.detail).join()).not.toContain("0000000000000000");
  });

  it("R1b: deleted, rejected and self-cancelled tickets are 'revoked', not 'unknown'", async () => {
    const s = await addScanner();
    const a = await member(2);
    expect((await deleteRegistration(db, a.id, "admin@test", T0)).ok).toBe(true);
    for (const code of a.codes) expect(await lookup(s, code)).toMatchObject({ verdict: "red", reason: "ticket_revoked" });

    const b = await member(1);
    // legacy case the reject action allows: accepted but never validated
    await db.prepare("UPDATE registrations SET membership_verified_at = NULL WHERE id = ?").bind(b.id).run();
    expect((await rejectMembership(db, b.id, "admin@test", T0)).ok).toBe(true);
    expect(await lookup(s, b.codes[0])).toMatchObject({ verdict: "red", reason: "ticket_revoked" });

    const c = await member(1);
    const rev = (await getRegistration(db, c.id))!.edit_rev ?? "";
    const cancelled = await cancelOwnRegistration(db, event, c.email!, rev, { now: new Date("2026-11-21T10:00:00.000Z"), ignoreWindow: true });
    expect(cancelled.ok).toBe(true);
    expect(await lookup(s, c.codes[0])).toMatchObject({ verdict: "red", reason: "ticket_revoked" });

    const reasons = await db.prepare("SELECT reason FROM revoked_tickets ORDER BY reason").all<{ reason: string }>();
    expect(reasons.results.map((r) => r.reason)).toEqual(["admin_deleted", "admin_deleted", "membership_rejected", "self_cancelled"]);
  });

  it("removing a person in a self-edit revokes only that person's code", async () => {
    const s = await addScanner();
    const a = await member(2);
    const reg = (await getRegistration(db, a.id))!;
    const res = await updateOwnRegistration(
      db,
      event,
      a.email!,
      reg.edit_rev ?? "",
      {
        registrantName: reg.registrant_name,
        whatsapp: reg.whatsapp!,
        participants: [{ id: a.parts[0].id, name: a.parts[0].full_name, gender: a.parts[0].gender!, ageGroup: a.parts[0].age_group }],
      },
      { now: new Date("2026-11-21T10:00:00.000Z"), ignoreWindow: true },
    );
    expect(res.ok).toBe(true);
    expect(await lookup(s, a.codes[1])).toMatchObject({ reason: "ticket_revoked" });
    expect(await lookup(s, a.codes[0])).toMatchObject({ verdict: "green" });
  });

  it("R5/R8: registrations that are not accepted or not paid are red", async () => {
    const s = await addScanner();
    const a = await member(1);
    await db.prepare("UPDATE registrations SET status = 'expired' WHERE id = ?").bind(a.id).run();
    expect(await lookup(s, a.codes[0])).toMatchObject({ verdict: "red", reason: "not_accepted" });

    const b = await member(1);
    await db.prepare("UPDATE registrations SET payment_status = 'pending' WHERE id = ?").bind(b.id).run();
    expect(await lookup(s, b.codes[0])).toMatchObject({ verdict: "red", reason: "payment_unclear" });
  });

  it("a paid non-member and a manual registration may enter", async () => {
    const s = await addScanner();
    const data = input({ people: 1, membership: "Tidak" });
    const res = await registerOnline(db, event, data, { now: T0, ignoreWindow: true });
    if (res.kind !== "pending_payment") throw new Error(res.kind);
    expect((await confirmPayment(db, res.registrationId, "admin@test", T0)).ok).toBe(true);
    const [p] = await getParticipants(db, res.registrationId);
    expect(await lookup(s, p.qr_token!)).toMatchObject({ verdict: "green" });
  });

  it("R6: before the gate opens is amber, only a lead may override; after the window too", async () => {
    const scanner = await addScanner();
    const lead = await addScanner("lead");
    const m = await member(1);
    const early = at("2026-12-05T06:00:00.000Z");
    expect(await lookup(scanner, m.codes[0], early)).toMatchObject({ verdict: "amber", reason: "gate_before", overridable: false });
    expect(await lookup(lead, m.codes[0], early)).toMatchObject({ verdict: "amber", reason: "gate_before", overridable: true });
    expect(await lookup(lead, m.codes[0], at("2026-12-05T16:00:00.000Z"))).toMatchObject({ reason: "gate_after" });

    // a scanner cannot admit through the gate, a lead with override can
    const id = m.parts[0].id;
    const denied = await admitParticipants(db, event, scanner, { participantIds: [id], requestId: "req-aaaa-0001", override: true }, early);
    expect(denied).toMatchObject({ ok: true, items: [{ id, status: "blocked", reason: "gate_before" }] });
    const allowed = await admitParticipants(db, event, lead, { participantIds: [id], requestId: "req-aaaa-0002", override: true }, early);
    expect(allowed).toMatchObject({ ok: true, items: [{ id, status: "admitted" }] });
    const log = await db.prepare("SELECT action, reason FROM checkin_log WHERE action = 'override'").first<{ action: string; reason: string }>();
    expect(log).toMatchObject({ action: "override", reason: "gate_before" });
  });

  it("an admin's custom window and the kill switch decide the gate", async () => {
    const s = await addScanner();
    const m = await member(1);
    await db.prepare("UPDATE events SET checkin_opens_at = ?, checkin_closes_at = ?").bind("2026-12-05T08:30:00.000Z", "2026-12-05T10:00:00.000Z").run();
    event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
    expect(gateState(event, DOOR)).toBe("before");
    expect(await lookup(s, m.codes[0], DOOR)).toMatchObject({ verdict: "amber" });
    expect(await lookup(s, m.codes[0], at("2026-12-05T09:00:00.000Z"))).toMatchObject({ verdict: "green" });

    await db.prepare("UPDATE events SET checkin_enabled = 0").run();
    event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
    expect(await lookup(s, m.codes[0], at("2026-12-05T09:00:00.000Z"))).toMatchObject({ verdict: "red", reason: "checkin_off" });
    const res = await admitParticipants(db, event, s, { participantIds: [m.parts[0].id], requestId: "req-aaaa-0003" }, at("2026-12-05T09:00:00.000Z"));
    expect(res).toMatchObject({ items: [{ status: "blocked", reason: "checkin_off" }] });
  });

  it("R9: a scanner cannot scan their own registration or their linked participant", async () => {
    const own = await member(2, { email: "petugas.saya@example.org" });
    const s = await addScanner("scanner", { email: "petugas.saya@example.org" });
    expect(await lookup(s, own.codes[0])).toMatchObject({ verdict: "red", reason: "own_ticket" });
    expect(await lookup(s, own.codes[1])).toMatchObject({ verdict: "red", reason: "own_ticket" });

    // second person inside someone else's registration, linked by an admin
    const other = await member(2);
    const linked = await addScanner("scanner", { participantId: other.parts[1].id });
    expect(await lookup(linked, other.codes[1])).toMatchObject({ reason: "own_ticket" });
    expect(await lookup(linked, other.codes[0])).toMatchObject({ verdict: "green" });

    // and the UPDATE refuses too (not only the lookup)
    const res = await admitParticipants(db, event, s, { participantIds: [own.parts[0].id], requestId: "req-aaaa-0004" }, DOOR);
    expect(res).toMatchObject({ items: [{ status: "blocked", reason: "own_ticket" }] });
    expect((await getParticipants(db, own.id))[0].checked_in_at).toBeNull();
  });
});

describe("admit (first scan wins)", () => {
  it("admits, then the second scan is a duplicate that says who and when", async () => {
    const a = await addScanner();
    const b = await addScanner();
    const m = await member(1);
    const id = m.parts[0].id;
    expect(await admitParticipants(db, event, a, { participantIds: [id], requestId: "req-aaaa-1001" }, DOOR)).toMatchObject({ items: [{ status: "admitted" }] });

    const dup = await lookup(b, m.codes[0], at(60_000));
    expect(dup).toMatchObject({ verdict: "red", reason: "already_in", soft: false, inside: 1 });
    expect(dup.first).toMatchObject({ at: DOOR.toISOString(), by: a.name, device: "Safari di iOS" });

    const second = await admitParticipants(db, event, b, { participantIds: [id], requestId: "req-bbbb-1001" }, at(61_000));
    expect(second).toMatchObject({ items: [{ status: "duplicate", reason: "already_in" }] });
    const p = (await getParticipants(db, m.id))[0];
    expect(p.checked_in_at).toBe(DOOR.toISOString());
    expect(p.checked_in_by).toBe(`scanner:${a.id}`);
    expect(p.checked_in_by).not.toContain("@");
  });

  it("two phones at the same instant: exactly one winner", async () => {
    const scanners = await Promise.all([addScanner(), addScanner(), addScanner(), addScanner()]);
    const m = await member(1);
    const id = m.parts[0].id;
    const results = await Promise.all(
      scanners.map((s, i) => admitParticipants(db, event, s, { participantIds: [id], requestId: `req-race-000${i}` }, DOOR)),
    );
    const outcomes = results.map((r) => (r.ok ? r.items[0].status : "error"));
    expect(outcomes.filter((o) => o === "admitted")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(3);
    const admits = await db.prepare("SELECT COUNT(*) n FROM checkin_log WHERE action = 'admit' AND participant_id = ?").bind(id).first<{ n: number }>();
    expect(admits!.n).toBe(1);
  });

  it("a retried tap (same request id) is idempotent and not a false duplicate", async () => {
    const s = await addScanner();
    const m = await member(1);
    const req = { participantIds: [m.parts[0].id], requestId: "req-retry-0001" };
    expect(await admitParticipants(db, event, s, req, DOOR)).toMatchObject({ items: [{ status: "admitted" }] });
    expect(await admitParticipants(db, event, s, req, at(3_000))).toMatchObject({ items: [{ status: "admitted" }] });
    const n = await db.prepare("SELECT COUNT(*) n FROM checkin_log WHERE action = 'admit'").first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("same scanner re-scanning within 10 seconds gets a soft note and no duplicate alarm in the log", async () => {
    const s = await addScanner();
    const m = await member(1);
    await admitParticipants(db, event, s, { participantIds: [m.parts[0].id], requestId: "req-soft-00001" }, DOOR);
    expect(await lookup(s, m.codes[0], at(4_000))).toMatchObject({ reason: "already_in", soft: true });
    const dups = await db.prepare("SELECT COUNT(*) n FROM checkin_log WHERE action = 'duplicate'").first<{ n: number }>();
    expect(dups!.n).toBe(0);
    expect(await lookup(s, m.codes[0], at(30_000))).toMatchObject({ reason: "already_in", soft: false });
  });

  it("family shortcut: several people in one batch, partly already inside", async () => {
    const s = await addScanner();
    const m = await member(4);
    const ids = m.parts.map((p) => p.id);
    await admitParticipants(db, event, s, { participantIds: [ids[0]], requestId: "req-fam-000001" }, DOOR);
    const res = await admitParticipants(db, event, s, { participantIds: ids, requestId: "req-fam-000002" }, at(120_000));
    if (!res.ok) throw new Error("bad");
    expect(res.items.map((i) => i.status)).toEqual(["duplicate", "admitted", "admitted", "admitted"]);
    const view = await lookup(s, m.codes[1], at(180_000));
    expect(view.inside).toBe(4);
    expect(view.total).toBe(4);
  });

  it("rejects bad input (empty, too many, bad request id)", async () => {
    const s = await addScanner();
    expect(await admitParticipants(db, event, s, { participantIds: [], requestId: "req-bad-000001" }, DOOR)).toMatchObject({ ok: false });
    expect(await admitParticipants(db, event, s, { participantIds: ["a"], requestId: "x" }, DOOR)).toMatchObject({ ok: false });
    const many = Array.from({ length: 13 }, (_, i) => `id-${i}`);
    expect(await admitParticipants(db, event, s, { participantIds: many, requestId: "req-bad-000002" }, DOOR)).toMatchObject({ ok: false });
  });

  it("deleting or rejecting is refused after check-in (existing guard) and the ticket stays valid", async () => {
    const s = await addScanner();
    const m = await member(1);
    await admitParticipants(db, event, s, { participantIds: [m.parts[0].id], requestId: "req-guard-0001" }, DOOR);
    expect((await deleteRegistration(db, m.id, "admin@test", at(1000))).ok).toBe(false);
    const revoked = await db.prepare("SELECT COUNT(*) n FROM revoked_tickets").first<{ n: number }>();
    expect(revoked!.n).toBe(0);
  });
});

describe("undo", () => {
  it("scanner: own entry within 2 minutes only; lead: any time; logged", async () => {
    const a = await addScanner();
    const b = await addScanner();
    const lead = await addScanner("lead");
    const m = await member(3);
    const [p0, p1, p2] = m.parts.map((p) => p.id);
    await admitParticipants(db, event, a, { participantIds: [p0, p1, p2], requestId: "req-undo-00001" }, DOOR);

    expect(await undoCheckin(db, event, b, p0, at(30_000))).toEqual({ ok: false, reason: "not_allowed" }); // not theirs
    expect(await undoCheckin(db, event, a, p0, at(150_000))).toEqual({ ok: false, reason: "not_allowed" }); // too late
    expect(await undoCheckin(db, event, a, p0, at(60_000))).toEqual({ ok: true });
    expect(await undoCheckin(db, event, a, p0, at(61_000))).toEqual({ ok: false, reason: "not_inside" });
    expect(await undoCheckin(db, event, lead, p1, at(3_600_000))).toEqual({ ok: true });

    const parts = await getParticipants(db, m.id);
    expect(parts.map((p) => p.checked_in_at !== null)).toEqual([false, false, true]);
    const undo = await db.prepare("SELECT COUNT(*) n FROM checkin_log WHERE action = 'undo'").first<{ n: number }>();
    expect(undo!.n).toBe(2);
  });

  it("admin (info desk): manual check-in and undo, both logged, no gate needed", async () => {
    const m = await member(1);
    const id = m.parts[0].id;
    expect((await adminCheckin(db, "admin@test", id, new Date("2026-12-05T03:00:00.000Z"))).ok).toBe(true);
    expect((await adminCheckin(db, "admin@test", id, DOOR)).ok).toBe(false);
    expect((await adminUndoCheckin(db, "admin@test", id, DOOR)).ok).toBe(true);
    expect((await adminUndoCheckin(db, "admin@test", id, DOOR)).ok).toBe(false);
    const actions = await db.prepare("SELECT action FROM checkin_log ORDER BY id").all<{ action: string }>();
    expect(actions.results.map((r) => r.action)).toEqual(["admin_admit", "admin_undo"]);
  });
});

describe("practice mode, escalation, numbers, retention", () => {
  it("practice codes simulate verdicts and never write", async () => {
    const s = await addScanner();
    const verdicts = await Promise.all(PRACTICE_CODES.map((c) => lookup(s, c)));
    expect(verdicts.every((v) => v.practice)).toBe(true);
    expect(verdicts.map((v) => v.verdict)).toEqual(["green", "green", "red", "red", "red", "red", "amber", "red", "green"]);
    const group = verdicts[1].group!;
    const res = await admitParticipants(db, event, s, { participantIds: group.map((g) => g.id), requestId: "req-prac-00001" }, DOOR);
    expect(res).toMatchObject({ ok: true });
    expect(await undoCheckin(db, event, s, group[0].id)).toEqual({ ok: true });
    await recordEscalation(db, event, s, { level: 1, participantId: group[0].id, reasonCode: "already_in" });
    for (const t of ["checkin_log", "participants", "audit_log"]) {
      const n = await db.prepare(`SELECT COUNT(*) n FROM ${t}`).first<{ n: number }>();
      expect(n!.n).toBe(0);
    }
    // a mix of practice and real ids is refused
    expect(await admitParticipants(db, event, s, { participantIds: [group[0].id, "real-0000-0001"], requestId: "req-prac-00002" }, DOOR)).toMatchObject({ ok: false });
  });

  it("escalations are logged with their level", async () => {
    const s = await addScanner();
    const m = await member(1);
    await recordEscalation(db, event, s, { level: 2, participantId: m.parts[0].id, reasonCode: "ticket_revoked" }, DOOR);
    const row = await db.prepare("SELECT action, reason, detail FROM checkin_log").first<{ action: string; reason: string; detail: string }>();
    expect(row).toMatchObject({ action: "escalate", reason: "ticket_revoked" });
    expect(JSON.parse(row!.detail)).toEqual({ level: 2 });
  });

  it("counts people with a valid ticket, per age group, and how many are inside", async () => {
    const s = await addScanner();
    const m = await member(3);
    await member(1);
    await admitParticipants(db, event, s, { participantIds: [m.parts[0].id, m.parts[1].id], requestId: "req-stat-00001" }, DOOR);
    const st = await checkinStats(db, event.id);
    expect(st.expected).toBe(4);
    expect(st.inside).toBe(2);
    expect(st.byAge.dewasa.expected + st.byAge.remaja.expected).toBe(4);
  });

  it("anonymises the log 30 days after the event, keeping counts and outcomes", async () => {
    const s = await addScanner();
    const m = await member(1);
    await admitParticipants(db, event, s, { participantIds: [m.parts[0].id], requestId: "req-anon-00001" }, DOOR);
    await db.prepare("INSERT INTO scanner_sessions (token_hash, scanner_id, method, created_at, expires_at) VALUES ('h', ?, 'pin', ?, ?)").bind(s.id, T0.toISOString(), T0.toISOString()).run();

    expect(await anonymiseCheckinData(db, new Date("2027-01-02T00:00:00.000Z"))).toBe(0); // 28 days after: too early
    expect(await anonymiseCheckinData(db, new Date("2027-01-05T00:00:00.000Z"))).toBe(1);
    const row = await db.prepare("SELECT scanner_label, device_label, action FROM checkin_log").first<{ scanner_label: string; device_label: string | null; action: string }>();
    expect(row).toEqual({ scanner_label: `scanner-${s.id}`, device_label: null, action: "admit" });
    expect((await db.prepare("SELECT COUNT(*) n FROM scanner_sessions").first<{ n: number }>())!.n).toBe(0);
    expect(await anonymiseCheckinData(db, new Date("2027-01-06T00:00:00.000Z"))).toBe(0); // idempotent
  });

  it("shortName keeps privacy but stays recognisable", () => {
    expect(shortName("Aisyah Dahlan")).toBe("Aisyah D.");
    expect(shortName("Muhammad Ali bin Abdullah")).toBe("Muhammad A.");
    expect(shortName("Budi")).toBe("Budi");
    expect(shortName("  siti   nur  ")).toBe("siti N.");
  });
});
