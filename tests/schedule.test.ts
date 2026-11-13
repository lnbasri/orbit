import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getEventById } from "../app/lib/db.server";
import { parseEuroToCents, updateEventDetails, updateEventPrice, updateEventTimes, updateQuotas, updateRegistrationWindow } from "../app/lib/events.server";
import { localInputToUtcIso, utcIsoToLocalInput } from "../app/lib/format";
import { quotaSummary, registerOnline, registrationWindowError } from "../app/lib/registration.server";
import { T0, input, resetDb, startDb } from "./helpers";

describe("Netherlands wall-clock <-> UTC", () => {
  it("winter time (CET, UTC+1)", () => {
    expect(localInputToUtcIso("2026-11-27T23:59")).toBe("2026-11-27T22:59:00.000Z");
    expect(utcIsoToLocalInput("2026-11-27T22:59:00.000Z")).toBe("2026-11-27T23:59");
  });

  it("summer time (CEST, UTC+2)", () => {
    expect(localInputToUtcIso("2026-07-01T12:00")).toBe("2026-07-01T10:00:00.000Z");
    expect(utcIsoToLocalInput("2026-07-01T10:00:00.000Z")).toBe("2026-07-01T12:00");
  });

  it("handles midnight and the event time (09:00 on 5 Dec = 08:00 UTC)", () => {
    expect(localInputToUtcIso("2026-12-05T09:00")).toBe("2026-12-05T08:00:00.000Z");
    expect(utcIsoToLocalInput("2026-11-15T23:00:00.000Z")).toBe("2026-11-16T00:00");
  });

  it("round-trips and rejects junk", () => {
    for (const v of ["2026-03-29T01:30", "2026-10-25T04:15", "2027-01-01T00:00"]) {
      expect(utcIsoToLocalInput(localInputToUtcIso(v))).toBe(v);
    }
    expect(localInputToUtcIso("")).toBeNull();
    expect(localInputToUtcIso("27-11-2026 23:59")).toBeNull();
    expect(utcIsoToLocalInput(null)).toBe("");
  });
});

let db: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => ({ db, dispose } = await startDb()));
afterAll(async () => dispose?.());
beforeEach(async () => {
  await resetDb(db);
});

const at = (iso: string) => new Date(iso);

describe("registration window", () => {
  it("is closed before opening, open between, closed from the deadline on", async () => {
    const e = (await getEventById(db, 1))!;
    const ev = { ...e, registration_opens_at: "2026-11-15T23:00:00.000Z", registration_closes_at: "2026-11-27T22:59:00.000Z" };
    expect(registrationWindowError(ev, at("2026-11-15T22:59:59.000Z"))).toMatch(/belum dibuka/);
    expect(registrationWindowError(ev, at("2026-11-20T10:00:00.000Z"))).toBeNull();
    expect(registrationWindowError(ev, at("2026-11-27T22:58:59.000Z"))).toBeNull();
    expect(registrationWindowError(ev, at("2026-11-27T22:59:00.000Z"))).toMatch(/ditutup/);
  });

  it("the seeded placeholder deadline is Fri 27 Nov 2026 23:59 Amsterdam", async () => {
    const e = (await getEventById(db, 1))!;
    expect(utcIsoToLocalInput(e.registration_closes_at)).toBe("2026-11-27T23:59");
  });

  it("registerOnline refuses after the deadline and works just before it", async () => {
    const e = (await getEventById(db, 1))!;
    const ev = { ...e, registration_opens_at: null, registration_closes_at: "2026-11-27T22:59:00.000Z" };
    expect((await registerOnline(db, ev, input(), { now: at("2026-11-27T22:59:00.000Z") })).kind).toBe("closed");
    expect((await registerOnline(db, ev, input(), { now: at("2026-11-27T22:58:00.000Z") })).kind).toBe("accepted");
  });
});

describe("admin: save registration window", () => {
  it("stores Netherlands time as UTC, audits it, and can clear the deadline", async () => {
    const res = await updateRegistrationWindow(db, "admin@x.nl", 1, "2026-11-16T00:00", "2026-11-29T20:00");
    expect(res.ok).toBe(true);
    const e = (await getEventById(db, 1))!;
    expect(e.registration_opens_at).toBe("2026-11-15T23:00:00.000Z");
    expect(e.registration_closes_at).toBe("2026-11-29T19:00:00.000Z");
    const audit = await db.prepare("SELECT actor FROM audit_log WHERE action = 'event.registration_window'").first();
    expect(audit).toMatchObject({ actor: "admin@x.nl" });

    expect((await updateRegistrationWindow(db, "admin@x.nl", 1, "", "")).ok).toBe(true);
    const cleared = (await getEventById(db, 1))!;
    expect([cleared.registration_opens_at, cleared.registration_closes_at]).toEqual([null, null]);
  });

  it("rejects bad input and impossible schedules without changing anything", async () => {
    await updateRegistrationWindow(db, "admin@x.nl", 1, "2026-11-16T00:00", "2026-11-27T23:59");
    const before = (await getEventById(db, 1))!;
    for (const [o, c, msg] of [
      ["nonsense", "2026-11-27T23:59", /pembukaan tidak valid/],
      ["2026-11-16T00:00", "nonsense", /Batas pendaftaran tidak valid/],
      ["2026-11-20T10:00", "2026-11-20T09:00", /setelah waktu pembukaan/],
      ["2026-11-16T00:00", "2026-12-05T10:00", /melewati waktu mulai acara/],
    ] as const) {
      const res = await updateRegistrationWindow(db, "admin@x.nl", 1, o, c);
      expect(res).toMatchObject({ ok: false, message: expect.stringMatching(msg) });
    }
    const after = (await getEventById(db, 1))!;
    expect([after.registration_opens_at, after.registration_closes_at]).toEqual([before.registration_opens_at, before.registration_closes_at]);
  });

  it("a deadline change takes effect for the next registration immediately", async () => {
    await updateRegistrationWindow(db, "admin@x.nl", 1, "", "2026-11-20T12:00");
    const e = (await getEventById(db, 1))!;
    expect((await registerOnline(db, e, input(), { now: at("2026-11-20T10:59:00.000Z") })).kind).toBe("accepted");
    expect((await registerOnline(db, e, input(), { now: at("2026-11-20T11:00:00.000Z") })).kind).toBe("closed");
  });
});

describe("quota-full closing", () => {
  it("reports each group as full only when no seats remain", async () => {
    const e = await resetDb(db, { member: 1, nonMember: 5 });
    expect((await quotaSummary(db, e)).member.remaining).toBe(1);
    await registerOnline(db, e, input(), { now: at("2026-11-20T10:00:00.000Z"), ignoreWindow: true });
    const q = await quotaSummary(db, e, at("2026-11-20T10:01:00.000Z"));
    expect([q.member.remaining, q.nonMember.remaining]).toEqual([0, 5]);
  });
});

describe("admin: event price", () => {
  it("parses euro input", () => {
    expect(parseEuroToCents("10")).toBe(1000);
    expect(parseEuroToCents("12,50")).toBe(1250);
    expect(parseEuroToCents("€ 7.5")).toBe(750);
    expect(parseEuroToCents("abc")).toBeNull();
    expect(parseEuroToCents("-1")).toBeNull();
  });

  it("only affects new registrations; old ones keep their amount", async () => {
    const reg = (email: string) => async () => {
      const ev = (await getEventById(db, 1))!;
      return registerOnline(db, ev, input({ people: 2, email, membership: "Tidak" }), { now: T0, ignoreWindow: true });
    };
    const before = await reg("a@x.nl")();
    expect(before.kind).toBe("pending_payment");
    const oldAmount = before.kind === "pending_payment" ? before.amountCents : 0;
    expect((await updateEventPrice(db, "admin@x.nl", 1, "15")).ok).toBe(true);
    expect((await getEventById(db, 1))!.price_non_member_cents).toBe(1500);
    const after = await reg("b@x.nl")();
    expect(after.kind === "pending_payment" && after.amountCents).toBe(3000);
    const first = await db.prepare("SELECT amount_cents FROM registrations WHERE lower(email) = 'a@x.nl'").first<{ amount_cents: number }>();
    expect(first!.amount_cents).toBe(oldAmount);
    expect(await db.prepare("SELECT 1 FROM audit_log WHERE action = 'event.price'").first()).toBeTruthy();
  });

  it("rejects invalid or zero price", async () => {
    expect((await updateEventPrice(db, "a@x.nl", 1, "0")).ok).toBe(false);
    expect((await updateEventPrice(db, "a@x.nl", 1, "x")).ok).toBe(false);
  });
});

describe("admin: event times", () => {
  it("saves new start and end (Netherlands time) and audits", async () => {
    const r = await updateEventTimes(db, "admin@x.nl", 1, "2026-12-12T10:00", "2026-12-12T15:00");
    expect(r.ok).toBe(true);
    const ev = (await getEventById(db, 1))!;
    expect([ev.starts_at, ev.ends_at]).toEqual(["2026-12-12T09:00:00.000Z", "2026-12-12T14:00:00.000Z"]);
    expect(await db.prepare("SELECT 1 FROM audit_log WHERE action = 'event.times'").first()).toBeTruthy();
  });

  it("rejects empty, invalid, reversed times and a start before the registration close", async () => {
    expect((await updateEventTimes(db, "a@x.nl", 1, "", "2026-12-12T15:00")).ok).toBe(false);
    expect((await updateEventTimes(db, "a@x.nl", 1, "2026-12-12T10:00", "nope")).ok).toBe(false);
    expect((await updateEventTimes(db, "a@x.nl", 1, "2026-12-12T15:00", "2026-12-12T10:00")).ok).toBe(false);
    await db.prepare("UPDATE events SET registration_closes_at = '2026-12-03T22:00:00.000Z' WHERE id = 1").run();
    const early = await updateEventTimes(db, "a@x.nl", 1, "2026-12-01T10:00", "2026-12-01T15:00");
    expect(early.ok).toBe(false);
  });
});

describe("admin: speaker and theme", () => {
  it("saves trimmed values, allows empty, and audits", async () => {
    expect((await updateEventDetails(db, "admin@x.nl", 1, "  Ust.  Baru ", " Tema Baru ")).ok).toBe(true);
    let ev = (await getEventById(db, 1))!;
    expect([ev.speaker, ev.theme]).toEqual(["Ust. Baru", "Tema Baru"]);
    expect((await updateEventDetails(db, "admin@x.nl", 1, "", "")).ok).toBe(true);
    ev = (await getEventById(db, 1))!;
    expect([ev.speaker, ev.theme]).toEqual([null, null]);
    expect(await db.prepare("SELECT 1 FROM audit_log WHERE action = 'event.details'").first()).toBeTruthy();
  });

  it("rejects over-long values", async () => {
    expect((await updateEventDetails(db, "a@x.nl", 1, "x".repeat(121), "")).ok).toBe(false);
    expect((await updateEventDetails(db, "a@x.nl", 1, "", "x".repeat(201))).ok).toBe(false);
  });
});

describe("admin: quotas", () => {
  it("can raise/lower but never below seats in use", async () => {
    const ev = (await getEventById(db, 1))!;
    await registerOnline(db, ev, input({ people: 3, membership: "Ya" }), { now: T0, ignoreWindow: true });
    expect((await updateQuotas(db, "a@x.nl", 1, "2", "50", T0)).ok).toBe(false);
    expect((await updateQuotas(db, "a@x.nl", 1, "3", "50", T0)).ok).toBe(true);
    const e = (await getEventById(db, 1))!;
    expect([e.quota_member, e.quota_non_member]).toEqual([3, 50]);
    expect((await updateQuotas(db, "a@x.nl", 1, "x", "5", T0)).ok).toBe(false);
    expect(await db.prepare("SELECT 1 FROM audit_log WHERE action = 'event.quota'").first()).toBeTruthy();
  });
});
