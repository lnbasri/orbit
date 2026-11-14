/**
 * Which phones of the scanning team are working? Pure functions, no database, safe in the browser.
 *
 * A phone cannot tell us it is offline: it simply stops reporting. So presence is INFERRED from the age of its last
 * heartbeat (sent every 20 s while the app is open) plus the state it last reported:
 *   online          reporting recently with the camera running
 *   idle            app open, camera not running (menu, self-test, camera not started)
 *   problem         reporting recently but the camera is denied or failed: this phone cannot scan
 *   away            the app was left or the phone went quiet for a short time (locked screen, app in background, weak signal)
 *   offline         silent for a longer time: no connection, phone off, app closed
 *   signed_out      no live session (never logged in, logged out, or expired)
 */
export const HEARTBEAT_SECONDS = 20;
/** Two missed heartbeats and a bit of slack. */
export const FRESH_SECONDS = 50;
/** Silent longer than this = offline (below it = away). */
export const OFFLINE_SECONDS = 150;

export type ReportedState = "scanning" | "idle" | "camera_problem" | "background";
export const REPORTED_STATES: ReportedState[] = ["scanning", "idle", "camera_problem", "background"];
export const isReportedState = (v: unknown): v is ReportedState => REPORTED_STATES.includes(v as ReportedState);

export type Presence = "online" | "idle" | "problem" | "away" | "offline" | "signed_out";

export function presenceOf(lastSeenAt: string | null, lastState: string | null, now: Date, hasSession = true): Presence {
  if (!hasSession) return "signed_out";
  if (!lastSeenAt) return "offline";
  const age = (now.getTime() - Date.parse(lastSeenAt)) / 1000;
  if (!Number.isFinite(age)) return "offline";
  if (age > OFFLINE_SECONDS) return "offline";
  if (age > FRESH_SECONDS) return "away";
  if (lastState === "camera_problem") return "problem";
  if (lastState === "background") return "away";
  if (lastState === "idle") return "idle";
  return "online";
}

/** Phones that can take a guest right now. */
export const isWorking = (p: Presence) => p === "online" || p === "idle";

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Gaps longer than this between two check-ins are breaks, not handling time. */
export const BREAK_MINUTES = 10;

/**
 * Typical minutes between two finished registrations of one volunteer (median), ignoring breaks.
 * `times` = the check-in moment of each registration (ISO), any order. Null when there are fewer than two.
 */
export function typicalMinutes(times: string[]): number | null {
  const t = times.map((x) => Date.parse(x)).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const minutes = (t[i] - t[i - 1]) / 60_000;
    if (minutes > 0 && minutes <= BREAK_MINUTES) gaps.push(minutes);
  }
  const m = median(gaps);
  return m === null ? null : Math.round(m * 10) / 10;
}

export interface BacklogInput {
  /** Registrations with a valid ticket where at least one person is not inside yet, and those people. */
  remainingRegistrations: number;
  remainingPeople: number;
  /** Registrations finished by the whole team in the last `windowMinutes`. */
  recentRegistrations: number;
  windowMinutes: number;
  /** Phones that can take a guest right now. */
  workingPhones: number;
  /** Planning figure: minutes per registration per volunteer (scanner-capacity). */
  plannedMinutesPerRegistration: number;
}

export interface Backlog {
  remainingRegistrations: number;
  remainingPeople: number;
  /** Registrations the team finishes per minute: measured over the window, or the planned pace when there is too little data. */
  perMinute: number;
  source: "measured" | "planned";
  /** Minutes to clear everything that is left IF all of it arrived now. Null when nothing can be processed (no working phone). */
  etaMinutes: number | null;
  /** What the working phones can do at the planned pace, for comparison. */
  plannedPerMinute: number;
}

/** Fewer finished registrations than this in the window and the measured pace is too noisy to trust. */
export const MIN_SAMPLE = 4;

export function estimateBacklog(i: BacklogInput): Backlog {
  const plannedPerMinute = i.workingPhones / i.plannedMinutesPerRegistration;
  const measured = i.recentRegistrations / i.windowMinutes;
  const useMeasured = i.recentRegistrations >= MIN_SAMPLE;
  const perMinute = useMeasured ? measured : plannedPerMinute;
  const etaMinutes = i.remainingRegistrations === 0 ? 0 : perMinute > 0 ? Math.ceil(i.remainingRegistrations / perMinute) : null;
  return {
    remainingRegistrations: i.remainingRegistrations,
    remainingPeople: i.remainingPeople,
    perMinute: Math.round(perMinute * 100) / 100,
    source: useMeasured ? "measured" : "planned",
    etaMinutes,
    plannedPerMinute: Math.round(plannedPerMinute * 100) / 100,
  };
}
