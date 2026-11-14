import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { admitParticipants, recordDeny, type ScannerIdentity } from "../app/lib/checkin.server";
import { scannerStats, teamOverview, touchScannerSession } from "../app/lib/checkin-insights.server";
import { getParticipants, type EventRow } from "../app/lib/db.server";
import { setMembershipVerified } from "../app/lib/payments.server";
import { registerOnline } from "../app/lib/registration.server";
import { createScannerSession, identifyScanner, scannerSessionCookie } from "../app/lib/scanner-auth.server";
import { FRESH_SECONDS, OFFLINE_SECONDS, estimateBacklog, median, presenceOf, typicalMinutes } from "../app/lib/scanner-presence";
import { addScanners } from "../app/lib/scanners.server";
import { T0, input, resetDb, startDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;
let event: EventRow;

const START = "2026-12-05T08:00:00.000Z";
const DOOR = new Date("2026-12-05T08:10:00.000Z");
const at = (seconds: number) => new Date(DOOR.getTime() + seconds * 1000);
const meta = { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1" };

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  await resetDb(db);
  await db.prepare("UPDATE events SET status = 'open', registration_closes_at = ?, starts_at = ?, ends_at = ?").bind("2026-11-27T22:59:00.000Z", START, "2026-12-05T13:30:00.000Z").run();
  event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
});

/** A scanner with a real session (cookie), as the app would have it. */
async function scannerWithSession(email: string, name: string, role: "scanner" | "lead" = "scanner", when = DOOR): Promise<ScannerIdentity> {
  await addScanners(db, "admin@x.nl", `${email}, ${name}`, role, T0);
  const s = await createScannerSession(db, email, meta, when);
  const req = new Request("https://checkin.example/scan", { headers: { Cookie: scannerSessionCookie(new Request("https://checkin.example/scan"), s!.token).split(";")[0] } });
  const who = await identifyScanner(req, { DB: db, APP_ENV: "production" }, when);
  return who!;
}

async function member(people = 1) {
  const res = await registerOnline(db, event, input({ people }), { now: T0, ignoreWindow: true });
  if (res.kind !== "pending_membership") throw new Error(res.kind);
  await setMembershipVerified(db, res.registrationId, "admin@test", true, T0);
  return { id: res.registrationId, parts: await getParticipants(db, res.registrationId) };
}

describe("presence from heartbeats (pure)", () => {
  it("online, idle, problem, away, offline and signed out", () => {
    const seen = at(0).toISOString();
    const now = (s: number) => at(s);
    expect(presenceOf(seen, "scanning", now(10))).toBe("online");
    expect(presenceOf(seen, "idle", now(10))).toBe("idle");
    expect(presenceOf(seen, "camera_problem", now(10))).toBe("problem");
    expect(presenceOf(seen, "background", now(10))).toBe("away");
    expect(presenceOf(seen, "scanning", now(FRESH_SECONDS + 5))).toBe("away"); // quiet for a short time
    expect(presenceOf(seen, "scanning", now(OFFLINE_SECONDS + 5))).toBe("offline");
    expect(presenceOf(null, null, now(0))).toBe("offline"); // logged in, never reported
    expect(presenceOf(seen, "scanning", now(0), false)).toBe("signed_out");
    expect(presenceOf("garbage", "scanning", now(0))).toBe("offline");
  });

  it("typical minutes: median of the gaps, breaks ignored", () => {
    const t = (min: number) => new Date(DOOR.getTime() + min * 60_000).toISOString();
    expect(typicalMinutes([t(0), t(2), t(4), t(7)])).toBe(2);
    expect(typicalMinutes([t(0), t(2), t(40), t(42)])).toBe(2); // the 38 minute gap is a break
    expect(typicalMinutes([t(0)])).toBeNull();
    expect(typicalMinutes([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("backlog: measured pace when there is enough data, planned pace otherwise, no working phone = no ETA", () => {
    const base = { remainingRegistrations: 30, remainingPeople: 70, windowMinutes: 15, plannedMinutesPerRegistration: 2.5 };
    expect(estimateBacklog({ ...base, recentRegistrations: 15, workingPhones: 4 })).toMatchObject({ source: "measured", perMinute: 1, etaMinutes: 30, plannedPerMinute: 1.6 });
    expect(estimateBacklog({ ...base, recentRegistrations: 2, workingPhones: 5 })).toMatchObject({ source: "planned", perMinute: 2, etaMinutes: 15 });
    expect(estimateBacklog({ ...base, recentRegistrations: 0, workingPhones: 0 })).toMatchObject({ etaMinutes: null });
    expect(estimateBacklog({ ...base, remainingRegistrations: 0, recentRegistrations: 0, workingPhones: 0 })).toMatchObject({ etaMinutes: 0 });
  });
});

describe("team overview for leads", () => {
  it("shows who is online, idle, has a camera problem, went quiet or is offline (and refreshes with each heartbeat)", async () => {
    const a = await scannerWithSession("a@x.nl", "Ayu");
    const b = await scannerWithSession("b@x.nl", "Budi");
    const c = await scannerWithSession("c@x.nl", "Citra");
    const d = await scannerWithSession("d@x.nl", "Dewi");
    await addScanners(db, "admin@x.nl", "never@x.nl, Eko", "scanner", T0); // never logged in
    await touchScannerSession(db, a, "scanning", at(0));
    await touchScannerSession(db, b, "idle", at(0));
    await touchScannerSession(db, c, "camera_problem", at(0));
    await touchScannerSession(db, d, "scanning", at(-120)); // quiet for 2 minutes

    const view = await teamOverview(db, event, at(5));
    const state = Object.fromEntries(view.members.map((m) => [m.label, m.presence]));
    expect(state).toEqual({ Ayu: "online", Budi: "idle", Citra: "problem", Dewi: "away", Eko: "signed_out" });
    expect(view.counts).toMatchObject({ online: 1, idle: 1, problem: 1, away: 1, signed_out: 1 });
    expect(view.members.find((m) => m.label === "Ayu")).toMatchObject({ device: "Safari di iOS", sessions: 1 });

    // 4 minutes later nobody reported: everyone who has a session is offline
    const later = await teamOverview(db, event, at(240));
    expect(later.members.filter((m) => m.presence === "offline")).toHaveLength(4);
    await touchScannerSession(db, a, "scanning", at(235));
    expect((await teamOverview(db, event, at(240))).members.find((m) => m.label === "Ayu")!.presence).toBe("online");
  });

  it("a second logged-in phone of the same person counts as one working scanner, and the freshest one decides", async () => {
    const a = await scannerWithSession("a@x.nl", "Ayu");
    const second = await createScannerSession(db, "a@x.nl", meta, at(10));
    expect(second).not.toBeNull();
    await touchScannerSession(db, a, "scanning", at(5));
    const view = await teamOverview(db, event, at(15));
    expect(view.members).toHaveLength(1);
    expect(view.members[0]).toMatchObject({ sessions: 2, presence: "online" });
  });

  it("progress per team member and the backlog, without any guest detail", async () => {
    const a = await scannerWithSession("a@x.nl", "Ayu", "lead");
    const b = await scannerWithSession("b@x.nl", "Budi");
    await touchScannerSession(db, a, "scanning", at(190)); // fresh at the moment of the overview below
    await touchScannerSession(db, b, "scanning", at(190));
    const f1 = await member(3);
    const f2 = await member(2);
    const f3 = await member(1);
    const f4 = await member(2);
    // Ayu admits family 1 (3 people) and family 3; Budi admits family 2
    await admitParticipants(db, event, a, { participantIds: f1.parts.map((p) => p.id), requestId: "req-ins-0001" }, at(0));
    await admitParticipants(db, event, a, { participantIds: f3.parts.map((p) => p.id), requestId: "req-ins-0002" }, at(120));
    await admitParticipants(db, event, b, { participantIds: f2.parts.map((p) => p.id), requestId: "req-ins-0003" }, at(60));
    await recordDeny(db, event, b, { participantId: f4.parts[0].id, reason: "behaviour", requestId: "req-ins-0004" }, at(90));

    const view = await teamOverview(db, event, at(200));
    const ayu = view.members.find((m) => m.label === "Ayu")!;
    const budi = view.members.find((m) => m.label === "Budi")!;
    expect(ayu).toMatchObject({ people: 4, registrations: 2, role: "lead", lastCheckinAt: at(120).toISOString() });
    expect(budi).toMatchObject({ people: 2, registrations: 1, refused: 1 });
    expect(view.inside).toBe(6);
    expect(view.expected).toBe(8);
    expect(view.backlog).toMatchObject({ remainingRegistrations: 1, remainingPeople: 2 });
    expect(view.backlog.source).toBe("planned"); // only 3 registrations in the last 15 minutes
    expect(view.backlog.etaMinutes).toBe(Math.ceil(1 / (2 / 2.5))); // 2 working phones, 2.5 min each -> 0.8 per minute

    // privacy: nothing about the guests, only the team
    const json = JSON.stringify(view);
    for (const p of [...f1.parts, ...f2.parts, ...f3.parts, ...f4.parts]) expect(json).not.toContain(p.full_name);
    expect(json).not.toMatch(/@example\.com|\+31/);
  });
});

describe("a scanner's own statistics", () => {
  it("counts what they did, ignores what others did, and has no guest data", async () => {
    const a = await scannerWithSession("a@x.nl", "Ayu");
    const b = await scannerWithSession("b@x.nl", "Budi");
    const fam = await member(3);
    const solo = await member(1);
    const other = await member(2);
    await admitParticipants(db, event, a, { participantIds: fam.parts.map((p) => p.id), requestId: "req-me-00001" }, at(0));
    await admitParticipants(db, event, a, { participantIds: solo.parts.map((p) => p.id), requestId: "req-me-00002" }, at(150));
    await admitParticipants(db, event, b, { participantIds: other.parts.map((p) => p.id), requestId: "req-me-00003" }, at(100));
    // Ayu's second scan of someone already inside: a duplicate she caught
    await admitParticipants(db, event, a, { participantIds: [other.parts[0].id], requestId: "req-me-00004" }, at(200));

    const mine = await scannerStats(db, event.id, a.id, at(300));
    expect(mine).toMatchObject({ people: 4, registrations: 2, duplicates: 1, caught: 1, refused: 0, undone: 0, escalated: 0, teamPeople: 6 });
    expect(mine.share).toBeCloseTo(4 / 6, 5);
    expect(mine.typicalMinutes).toBe(2.5);
    expect(mine.firstAt).toBe(at(0).toISOString());
    expect(mine.lastAt).toBe(at(150).toISOString());
    expect(mine.buckets).toHaveLength(8);
    expect(mine.buckets.reduce((n, x) => n + x.n, 0)).toBe(4);

    const theirs = await scannerStats(db, event.id, b.id, at(300));
    expect(theirs).toMatchObject({ people: 2, registrations: 1, duplicates: 0 });

    const json = JSON.stringify(mine);
    for (const p of [...fam.parts, ...solo.parts, ...other.parts]) expect(json).not.toContain(p.full_name);
  });

  it("an undone check-in no longer counts for the scanner", async () => {
    const a = await scannerWithSession("a@x.nl", "Ayu");
    const solo = await member(1);
    await admitParticipants(db, event, a, { participantIds: solo.parts.map((p) => p.id), requestId: "req-me-00005" }, at(0));
    await db.prepare("UPDATE participants SET checked_in_at = NULL, checked_in_by = NULL WHERE id = ?").bind(solo.parts[0].id).run();
    expect((await scannerStats(db, event.id, a.id, at(10))).people).toBe(0);
  });

  it("zero everything for a scanner who has not admitted anybody yet", async () => {
    const a = await scannerWithSession("a@x.nl", "Ayu");
    expect(await scannerStats(db, event.id, a.id, at(0))).toMatchObject({ people: 0, registrations: 0, firstAt: null, lastAt: null, typicalMinutes: null, share: 0 });
  });
});
