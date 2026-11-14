import { checkinStats, scannerActor, scannerLabel, type ScannerIdentity } from "./checkin.server";
import type { EventRow } from "./db.server";
import { CAPACITY_ASSUMPTIONS } from "./scanner-capacity";
import {
  estimateBacklog,
  isWorking,
  presenceOf,
  typicalMinutes,
  type Backlog,
  type Presence,
  type ReportedState,
} from "./scanner-presence";

/**
 * Numbers for the scanning team while the door is open. Nothing here contains guest details: only counts, times and the
 * team's own names and devices. A scanner sees their own statistics; a team lead sees every team member and the backlog.
 */

/** Heartbeat: remembers the last time and state this phone (session) reported. No-op without a session (development bypass). */
export async function touchScannerSession(db: D1Database, scanner: ScannerIdentity, state: ReportedState, now = new Date()) {
  if (!scanner.sessionHash) return;
  await db
    .prepare("UPDATE scanner_sessions SET last_seen_at = ?, last_state = ? WHERE token_hash = ?")
    .bind(now.toISOString(), state, scanner.sessionHash)
    .run();
}

/** Cheap per-heartbeat numbers for the scanner's own counter. */
export async function myTotals(db: D1Database, eventId: number, scannerId: number) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS people, COUNT(DISTINCT p.registration_id) AS registrations FROM participants p JOIN registrations r ON r.id = p.registration_id
       WHERE r.event_id = ? AND p.checked_in_by = ? AND p.checked_in_at IS NOT NULL`,
    )
    .bind(eventId, scannerActor({ id: scannerId }))
    .first<{ people: number; registrations: number }>();
  return { people: row?.people ?? 0, registrations: row?.registrations ?? 0 };
}

/** The few numbers a lead sees on the scanner home screen (full detail is the team screen). */
export function leadSummary(t: TeamOverview) {
  return {
    working: t.members.filter((m) => isWorking(m.presence)).length,
    total: t.members.length,
    problem: t.counts.problem,
    quiet: t.counts.away + t.counts.offline,
    remainingRegistrations: t.backlog.remainingRegistrations,
    remainingPeople: t.backlog.remainingPeople,
    etaMinutes: t.backlog.etaMinutes,
  };
}

export const BUCKET_MINUTES = 15;
export const BUCKET_COUNT = 8;

export interface MyStats {
  /** People and registrations this scanner admitted (net of undo: counted from who is inside now). */
  people: number;
  registrations: number;
  firstAt: string | null;
  lastAt: string | null;
  /** Typical minutes between two finished registrations, breaks ignored. */
  typicalMinutes: number | null;
  /** Scans of tickets that were refused by the rules and caught here (second scans, cancelled, unknown ...). */
  caught: number;
  duplicates: number;
  refused: number;
  undone: number;
  escalated: number;
  /** Share of everybody inside who was admitted by this scanner (0..1). */
  share: number;
  teamPeople: number;
  /** Check-ins per 15 minutes over the last 2 hours, oldest first (people). */
  buckets: { start: string; n: number }[];
}

interface Scan {
  at: string;
  registrationId: string;
}

async function scansOf(db: D1Database, eventId: number, scannerId: number): Promise<Scan[]> {
  const { results } = await db
    .prepare(
      `SELECT p.checked_in_at AS at, p.registration_id AS registrationId FROM participants p JOIN registrations r ON r.id = p.registration_id
       WHERE r.event_id = ? AND p.checked_in_by = ? AND p.checked_in_at IS NOT NULL ORDER BY p.checked_in_at`,
    )
    .bind(eventId, scannerActor({ id: scannerId }))
    .all<Scan>();
  return results;
}

function firstPerRegistration(scans: Scan[]): string[] {
  const seen = new Map<string, string>();
  for (const s of scans) if (!seen.has(s.registrationId)) seen.set(s.registrationId, s.at);
  return [...seen.values()];
}

function buckets(scans: Scan[], now: Date) {
  const size = BUCKET_MINUTES * 60_000;
  const end = Math.ceil(now.getTime() / size) * size;
  const out = Array.from({ length: BUCKET_COUNT }, (_, i) => ({ start: new Date(end - (BUCKET_COUNT - i) * size).toISOString(), n: 0 }));
  for (const s of scans) {
    const idx = Math.floor((Date.parse(s.at) - (end - BUCKET_COUNT * size)) / size);
    if (idx >= 0 && idx < BUCKET_COUNT) out[idx].n++;
  }
  return out;
}

async function actionCounts(db: D1Database, eventId: number, scannerId?: number): Promise<Map<number, Record<string, number>>> {
  const { results } = await db
    .prepare(
      `SELECT scanner_id AS id, action, COUNT(*) AS n FROM checkin_log
       WHERE event_id = ? AND scanner_id IS NOT NULL ${scannerId ? "AND scanner_id = ?" : ""} GROUP BY scanner_id, action`,
    )
    .bind(...(scannerId ? [eventId, scannerId] : [eventId]))
    .all<{ id: number; action: string; n: number }>();
  const map = new Map<number, Record<string, number>>();
  for (const r of results) map.set(r.id, { ...(map.get(r.id) ?? {}), [r.action]: r.n });
  return map;
}

export async function scannerStats(db: D1Database, eventId: number, scannerId: number, now = new Date()): Promise<MyStats> {
  const [scans, counts, inside] = await Promise.all([scansOf(db, eventId, scannerId), actionCounts(db, eventId, scannerId), checkinStats(db, eventId)]);
  const c = counts.get(scannerId) ?? {};
  const regTimes = firstPerRegistration(scans);
  const duplicates = c.duplicate ?? 0;
  return {
    people: scans.length,
    registrations: regTimes.length,
    firstAt: scans[0]?.at ?? null,
    lastAt: scans[scans.length - 1]?.at ?? null,
    typicalMinutes: typicalMinutes(regTimes),
    duplicates,
    caught: duplicates + (c.blocked ?? 0) + (c.invalid ?? 0),
    refused: c.deny ?? 0,
    undone: c.undo ?? 0,
    escalated: c.escalate ?? 0,
    share: inside.inside > 0 ? scans.length / inside.inside : 0,
    teamPeople: inside.inside,
    buckets: buckets(scans, now),
  };
}

export interface TeamMember {
  id: number;
  label: string;
  role: "scanner" | "lead";
  presence: Presence;
  device: string | null;
  lastSeenAt: string | null;
  /** Several logged-in phones for one person. */
  sessions: number;
  testPassed: boolean | null;
  people: number;
  registrations: number;
  lastCheckinAt: string | null;
  typicalMinutes: number | null;
  caught: number;
  refused: number;
}

export interface TeamOverview {
  members: TeamMember[];
  counts: Record<Presence, number>;
  inside: number;
  expected: number;
  backlog: Backlog;
  /** Registrations finished by the whole team in the last 15 minutes. */
  recentRegistrations: number;
}

const RECENT_MINUTES = 15;

export async function teamOverview(db: D1Database, event: EventRow, now = new Date()): Promise<TeamOverview> {
  const nowIso = now.toISOString();
  const recentIso = new Date(now.getTime() - RECENT_MINUTES * 60_000).toISOString();
  const live = "ss.scanner_id = s.id AND ss.expires_at > ?";
  const [scanners, checkins, perReg, remaining, recent, counts, totals] = await Promise.all([
    db
      .prepare(
        `SELECT s.id, s.name, s.email, s.role,
           (SELECT MAX(ss.last_seen_at) FROM scanner_sessions ss WHERE ${live}) AS last_seen,
           (SELECT ss.last_state FROM scanner_sessions ss WHERE ${live} ORDER BY ss.last_seen_at DESC LIMIT 1) AS last_state,
           (SELECT ss.device_label FROM scanner_sessions ss WHERE ${live} ORDER BY ss.last_seen_at DESC LIMIT 1) AS device,
           (SELECT COUNT(*) FROM scanner_sessions ss WHERE ${live}) AS sessions,
           (SELECT t.passed FROM scanner_selftests t WHERE t.scanner_id = s.id ORDER BY t.id DESC LIMIT 1) AS test_passed
         FROM scanners s WHERE s.active = 1 ORDER BY s.role DESC, s.name, s.email`,
      )
      .bind(nowIso, nowIso, nowIso, nowIso)
      .all<{ id: number; name: string | null; email: string; role: "scanner" | "lead"; last_seen: string | null; last_state: string | null; device: string | null; sessions: number; test_passed: number | null }>(),
    db
      .prepare(
        `SELECT p.checked_in_by AS actor, COUNT(*) AS people, COUNT(DISTINCT p.registration_id) AS regs, MAX(p.checked_in_at) AS last
         FROM participants p JOIN registrations r ON r.id = p.registration_id
         WHERE r.event_id = ? AND p.checked_in_by LIKE 'scanner:%' AND p.checked_in_at IS NOT NULL GROUP BY p.checked_in_by`,
      )
      .bind(event.id)
      .all<{ actor: string; people: number; regs: number; last: string }>(),
    db
      .prepare(
        `SELECT p.checked_in_by AS actor, p.registration_id AS reg, MIN(p.checked_in_at) AS at
         FROM participants p JOIN registrations r ON r.id = p.registration_id
         WHERE r.event_id = ? AND p.checked_in_by LIKE 'scanner:%' AND p.checked_in_at IS NOT NULL GROUP BY p.checked_in_by, p.registration_id`,
      )
      .bind(event.id)
      .all<{ actor: string; reg: string; at: string }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT r.id) AS regs, COUNT(p.id) AS people FROM participants p JOIN registrations r ON r.id = p.registration_id
         WHERE r.event_id = ? AND r.status = 'accepted' AND p.status = 'accepted' AND p.qr_token IS NOT NULL AND p.checked_in_at IS NULL`,
      )
      .bind(event.id)
      .first<{ regs: number; people: number }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT p.registration_id) AS n FROM participants p JOIN registrations r ON r.id = p.registration_id
         WHERE r.event_id = ? AND p.checked_in_at >= ?`,
      )
      .bind(event.id, recentIso)
      .first<{ n: number }>(),
    actionCounts(db, event.id),
    checkinStats(db, event.id),
  ]);

  const byActor = new Map(checkins.results.map((r) => [r.actor, r]));
  const timesBy = new Map<string, string[]>();
  for (const r of perReg.results) timesBy.set(r.actor, [...(timesBy.get(r.actor) ?? []), r.at]);

  const members: TeamMember[] = scanners.results.map((s) => {
    const actor = scannerActor({ id: s.id });
    const c = counts.get(s.id) ?? {};
    const done = byActor.get(actor);
    return {
      id: s.id,
      label: scannerLabel({ name: s.name, email: s.email }),
      role: s.role,
      presence: presenceOf(s.last_seen, s.last_state, now, s.sessions > 0),
      device: s.device,
      lastSeenAt: s.last_seen,
      sessions: s.sessions,
      testPassed: s.test_passed === null ? null : s.test_passed === 1,
      people: done?.people ?? 0,
      registrations: done?.regs ?? 0,
      lastCheckinAt: done?.last ?? null,
      typicalMinutes: typicalMinutes(timesBy.get(actor) ?? []),
      caught: (c.duplicate ?? 0) + (c.blocked ?? 0) + (c.invalid ?? 0),
      refused: c.deny ?? 0,
    };
  });

  const tally: Record<Presence, number> = { online: 0, idle: 0, problem: 0, away: 0, offline: 0, signed_out: 0 };
  for (const m of members) tally[m.presence]++;

  const backlog = estimateBacklog({
    remainingRegistrations: remaining?.regs ?? 0,
    remainingPeople: remaining?.people ?? 0,
    recentRegistrations: recent?.n ?? 0,
    windowMinutes: RECENT_MINUTES,
    workingPhones: members.filter((m) => isWorking(m.presence)).length,
    plannedMinutesPerRegistration: CAPACITY_ASSUMPTIONS.minutesPerRegistration.planning,
  });

  return { members, counts: tally, inside: totals.inside, expected: totals.expected, backlog, recentRegistrations: recent?.n ?? 0 };
}
