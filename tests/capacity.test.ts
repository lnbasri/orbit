import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { EventRow } from "../app/lib/db.server";
import { setMembershipVerified } from "../app/lib/payments.server";
import { registerOnline } from "../app/lib/registration.server";
import { CAPACITY_ASSUMPTIONS, compareTeam, recommendTeam, teamScenarios } from "../app/lib/scanner-capacity";
import { teamDemand } from "../app/lib/scanners.server";
import { T0, input, resetDb, startDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;
let event: EventRow;

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  event = await resetDb(db, { member: 120, nonMember: 80 });
});

describe("staffing recommendation (1 to 4 minutes per registration)", () => {
  it("never recommends fewer than the minimum team, with at least one lead", () => {
    expect(recommendTeam(0)).toMatchObject({ team: CAPACITY_ASSUMPTIONS.minTeam, leads: 1, peakLookups: 0 });
    expect(recommendTeam(5).team).toBe(CAPACITY_ASSUMPTIONS.minTeam);
  });

  it("scales with the pace: 30 minute peak, 70% arrive then, 20% spare, one lead per 6", () => {
    // 100 registrations -> 70 in the peak window.
    expect(recommendTeam(100, "best")).toMatchObject({ peakLookups: 70, perScannerPeak: 30, team: 4, leads: 1 }); // ceil(70/30)=3 people, x1.2 spare = 3.6 -> 4
  });

  it("matches the formula by hand at the three paces", () => {
    const a = CAPACITY_ASSUMPTIONS;
    for (const regs of [50, 100, 234, 600]) {
      for (const pace of ["best", "planning", "worst"] as const) {
        const peak = Math.ceil(regs * a.peakShare);
        const per = Math.floor(a.peakMinutes / a.minutesPerRegistration[pace]);
        const expected = Math.max(a.minTeam, Math.ceil(Math.ceil(peak / per) * a.spareFactor));
        expect(recommendTeam(regs, pace).team, `${regs}/${pace}`).toBe(expected);
      }
    }
  });

  it("slower handling needs more people (monotonic in pace and in registrations)", () => {
    for (const regs of [40, 120, 234, 500]) {
      expect(recommendTeam(regs, "best").team).toBeLessThanOrEqual(recommendTeam(regs, "planning").team);
      expect(recommendTeam(regs, "planning").team).toBeLessThanOrEqual(recommendTeam(regs, "worst").team);
    }
    expect(recommendTeam(500, "planning").team).toBeGreaterThanOrEqual(recommendTeam(234, "planning").team);
  });

  it("a full quota with the 4 minute case needs a large team: the user's 1-4 minute range matters", () => {
    const full = recommendTeam(234, "worst"); // 164 in the peak, 7 per volunteer -> 24 -> 29
    expect(full.team).toBeGreaterThan(20);
    expect(recommendTeam(234, "best").team).toBeLessThan(full.team / 2);
  });

  it("three scenarios grow from confirmed to full quota and carry a best/worst range", () => {
    const [now, pipeline, full] = teamScenarios({ acceptedRegistrations: 100, acceptedPeople: 250, pendingRegistrations: 40, quotaSeats: 700, seatsUsed: 280 });
    expect([now.registrations, pipeline.registrations]).toEqual([100, 140]);
    expect(full.registrations).toBe(350); // 700 seats at 2 seats per registration (280 seats / 140 registrations)
    expect(now.rec.team).toBeLessThanOrEqual(pipeline.rec.team);
    expect(pipeline.rec.team).toBeLessThanOrEqual(full.rec.team);
    for (const s of [now, pipeline, full]) {
      expect(s.range.best.team).toBeLessThanOrEqual(s.rec.team);
      expect(s.rec.team).toBeLessThanOrEqual(s.range.worst.team);
    }
  });

  it("with no registrations yet it still answers (fallback people per registration)", () => {
    const s = teamScenarios({ acceptedRegistrations: 0, acceptedPeople: 0, pendingRegistrations: 0, quotaSeats: 350, seatsUsed: 0 });
    expect(s[0].registrations).toBe(0);
    expect(s[2].registrations).toBeGreaterThan(0);
    expect(s[2].rec.team).toBeGreaterThanOrEqual(2);
  });

  it("compares with the registered team: short, tight, enough, robust (and a missing lead)", () => {
    const [s] = teamScenarios({ acceptedRegistrations: 120, acceptedPeople: 300, pendingRegistrations: 0, quotaSeats: 300, seatsUsed: 300 });
    const { best, worst } = s.range;
    expect(best.team).toBeLessThan(s.rec.team);
    expect(s.rec.team).toBeLessThan(worst.team);
    const have = (active: number, leads = 3) => compareTeam(s, { active, leads, ready: active });
    expect(have(best.team - 1).verdict).toBe("short");
    expect(have(best.team).verdict).toBe("tight");
    expect(have(s.rec.team).verdict).toBe("enough");
    expect(have(worst.team).verdict).toBe("robust");
    expect(have(worst.team, 0)).toMatchObject({ verdict: "tight", leadGap: -s.rec.leads }); // no lead: never better than tight
    expect(have(s.rec.team + 1)).toMatchObject({ teamGap: 1, worstGap: worst.team - s.rec.team - 1 });
    expect(compareTeam(s, { active: 4, leads: 1, ready: 1 }).readyGap).toBe(1 - s.rec.team);
  });

  it("reads the real demand from the database: accepted vs pending vs quota", async () => {
    await db.prepare("UPDATE events SET status = 'open'").run();
    event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
    // a validated family of 3 (accepted, 3 tickets), a member still waiting for validation, a non-member waiting for payment
    const fam = await registerOnline(db, event, input({ people: 3 }), { now: T0, ignoreWindow: true });
    if (fam.kind !== "pending_membership") throw new Error(fam.kind);
    await setMembershipVerified(db, fam.registrationId, "admin@test", true, T0);
    await registerOnline(db, event, input({ people: 2 }), { now: T0, ignoreWindow: true });
    const nm = await registerOnline(db, event, input({ people: 1, membership: "Tidak" }), { now: T0, ignoreWindow: true });
    expect(nm.kind).toBe("pending_payment");

    const d = await teamDemand(db, event, T0);
    expect(d).toMatchObject({ acceptedRegistrations: 1, acceptedPeople: 3, pendingRegistrations: 2, quotaSeats: 200 });
    expect(d.seatsUsed).toBeGreaterThanOrEqual(4);
  });
});
