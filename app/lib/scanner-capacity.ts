/**
 * How many scanning-team members does the door need? A transparent estimate, not a promise: every assumption is a
 * constant below and is shown to the committee next to the result. Pure functions (no database), safe in the client.
 *
 * Unit of work = one REGISTRATION at the door. A family is one scan and one tap for all its members (family shortcut),
 * but the handover is a real interaction: identification, a one-time physical token and a short briefing (user, 14 Nov:
 * 1 to 4 minutes per registration depending on the situation). So the load follows registrations, not people.
 */
export const CAPACITY_ASSUMPTIONS = {
  /** Minutes one volunteer spends per registration: smooth case, planning figure (middle of the range), difficult case. */
  minutesPerRegistration: { best: 1, planning: 2.5, worst: 4 },
  /** Share of all registrations that arrive within the peak window (people come shortly before the start). */
  peakShare: 0.7,
  /** Length of that peak window, minutes. */
  peakMinutes: 30,
  /** Spare capacity for breaks, a dead phone or a slow queue. */
  spareFactor: 1.2,
  /** One team lead per this many team members (rounded up, at least one). */
  teamPerLead: 6,
  /** Never fewer than this at one entrance (one handles the guest, one backs up and handles problems). */
  minTeam: 2,
  /** Average people per registration, used only when there are no registrations yet to measure it. */
  fallbackPeoplePerRegistration: 2.5,
} as const;

export type Pace = keyof typeof CAPACITY_ASSUMPTIONS.minutesPerRegistration;

export interface Recommendation {
  /** Registrations the door has to process. */
  lookups: number;
  /** Registrations arriving in the peak window. */
  peakLookups: number;
  /** Registrations ONE volunteer can finish in the peak window at this pace. */
  perScannerPeak: number;
  /** Recommended team size, leads included (a lead can handle guests too). */
  team: number;
  leads: number;
}

export function recommendTeam(lookups: number, pace: Pace = "planning"): Recommendation {
  const a = CAPACITY_ASSUMPTIONS;
  const safe = Math.max(0, Math.ceil(lookups));
  const peakLookups = Math.ceil(safe * a.peakShare);
  const perScannerPeak = Math.max(1, Math.floor(a.peakMinutes / a.minutesPerRegistration[pace]));
  const base = Math.ceil(peakLookups / perScannerPeak);
  const team = Math.max(a.minTeam, Math.ceil(base * a.spareFactor));
  return { lookups: safe, peakLookups, perScannerPeak, team, leads: Math.max(1, Math.ceil(team / a.teamPerLead)) };
}

export interface TeamDemandInput {
  /** Registrations with a valid ticket now (accepted, QR issued) and the people in them. */
  acceptedRegistrations: number;
  acceptedPeople: number;
  /** Registrations still waiting (member validation or payment): they may become tickets before the event. */
  pendingRegistrations: number;
  /** Seats the quotas allow in total (member + non-member). */
  quotaSeats: number;
  /** Seats currently used by accepted + pending online registrations (the quota's own measure). */
  seatsUsed: number;
}

export interface Scenario {
  key: "now" | "pipeline" | "full";
  registrations: number;
  /** The planning pace (2.5 min) is what the comparison uses; best and worst give the range. */
  rec: Recommendation;
  range: { best: Recommendation; worst: Recommendation };
}

/** Three views of the same door: what is confirmed now, with everything pending, and with every quota seat filled. */
export function teamScenarios(d: TeamDemandInput): Scenario[] {
  const a = CAPACITY_ASSUMPTIONS;
  const perReg = d.acceptedRegistrations > 0 ? d.acceptedPeople / d.acceptedRegistrations : a.fallbackPeoplePerRegistration;
  const seatsPerReg =
    d.seatsUsed > 0 && d.acceptedRegistrations + d.pendingRegistrations > 0 ? d.seatsUsed / (d.acceptedRegistrations + d.pendingRegistrations) : perReg;
  const fullRegs = Math.max(d.acceptedRegistrations + d.pendingRegistrations, Math.ceil(d.quotaSeats / Math.max(1, seatsPerReg)));
  const regs = { now: d.acceptedRegistrations, pipeline: d.acceptedRegistrations + d.pendingRegistrations, full: fullRegs };
  return (["now", "pipeline", "full"] as const).map((key) => ({
    key,
    registrations: regs[key],
    rec: recommendTeam(regs[key], "planning"),
    range: { best: recommendTeam(regs[key], "best"), worst: recommendTeam(regs[key], "worst") },
  }));
}

/** short: below the smooth case. tight: only fine if everything goes smoothly. enough: covers the planning pace. robust: covers the difficult case too. */
export type Verdict = "short" | "tight" | "enough" | "robust";

export interface TeamComparison {
  /** Active scanners (leads included) and active leads. */
  have: number;
  haveLeads: number;
  /** Active scanners whose last device self-test passed. */
  haveReady: number;
  /** Positive = surplus, negative = missing, against the planning figure. */
  teamGap: number;
  leadGap: number;
  readyGap: number;
  /** Missing people against the difficult case (0 = covered). */
  worstGap: number;
  verdict: Verdict;
}

export function compareTeam(
  s: Pick<Scenario, "rec" | "range">,
  have: { active: number; leads: number; ready: number },
): TeamComparison {
  const teamGap = have.active - s.rec.team;
  const leadGap = have.leads - s.rec.leads;
  const verdict: Verdict =
    have.active < s.range.best.team ? "short" : have.active < s.rec.team || leadGap < 0 ? "tight" : have.active < s.range.worst.team ? "enough" : "robust";
  return {
    have: have.active,
    haveLeads: have.leads,
    haveReady: have.ready,
    teamGap,
    leadGap,
    readyGap: have.ready - s.rec.team,
    worstGap: Math.max(0, s.range.worst.team - have.active),
    verdict,
  };
}
