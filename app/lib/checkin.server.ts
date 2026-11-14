import { auditStatement, type EventRow } from "./db.server";
import { TICKET_TOKEN_PATTERN } from "./ids";

/**
 * D-day check-in (docs/scanner-plan.md). Two steps, both decided on the server:
 *  1. lookupTicket  = read-only verdict (green / amber / red) for a scanned code, nothing is changed;
 *  2. admitParticipants = ONE conditional UPDATE per person inside a db.batch. The rules are checked again inside the
 *     UPDATE, so two phones scanning the same code in the same instant produce exactly one winner (first scan wins).
 * The scanner only ever sees a short name ("Aisyah D."), age group and counts: never email, phone or payment data.
 */

export type ScannerRole = "scanner" | "lead";

export interface ScannerIdentity {
  id: number;
  email: string;
  name: string | null;
  role: ScannerRole;
  participantId: string | null;
  deviceLabel: string | null;
}

export type ReasonCode =
  | "unknown_code"
  | "ticket_revoked"
  | "already_in"
  | "not_accepted"
  | "payment_unclear"
  | "gate_before"
  | "gate_after"
  | "checkin_off"
  | "own_ticket"
  | "wrong_event";

export type Verdict = "green" | "amber" | "red";
export type GateState = "off" | "before" | "open" | "after";
export type AgeGroup = "balita" | "anak" | "remaja" | "dewasa";

export const SOFT_RESCAN_MS = 10_000;
export const UNDO_WINDOW_MS = 2 * 60_000;
export const MAX_ADMIT_BATCH = 12;
const LOOKUPS_PER_MINUTE = 40;
const DENY_REASONS = ["ticket_problem", "behaviour", "other"] as const;
export type DenyReason = (typeof DENY_REASONS)[number];

const PAID_OK = "('free', 'paid', 'manual')";

// ---------------------------------------------------------------- gate

export function gateWindow(event: Pick<EventRow, "starts_at" | "ends_at" | "checkin_opens_at" | "checkin_closes_at">) {
  return {
    opens: event.checkin_opens_at ?? new Date(Date.parse(event.starts_at) - 3_600_000).toISOString(),
    closes: event.checkin_closes_at ?? new Date(Date.parse(event.ends_at) + 3_600_000).toISOString(),
  };
}

export function gateState(
  event: Pick<EventRow, "starts_at" | "ends_at" | "checkin_enabled" | "checkin_opens_at" | "checkin_closes_at">,
  now: Date,
): GateState {
  if (!event.checkin_enabled) return "off";
  const { opens, closes } = gateWindow(event);
  const iso = now.toISOString();
  if (iso < opens) return "before";
  if (iso > closes) return "after";
  return "open";
}

// ---------------------------------------------------------------- practice mode (never touches the database)

/** Fixed practice codes (deliberately NOT the 26-character real format). Printed on the briefing sheet. */
export const PRACTICE_CODES = [
  "PPME-LATIHAN-01",
  "PPME-LATIHAN-02",
  "PPME-LATIHAN-03",
  "PPME-LATIHAN-04",
  "PPME-LATIHAN-05",
  "PPME-LATIHAN-06",
  "PPME-LATIHAN-07",
  "PPME-LATIHAN-08",
  "PPME-LATIHAN-09",
] as const;
const PRACTICE_RE = /^PPME-LATIHAN-0[1-9]$/;
export const isPracticeCode = (code: string) => PRACTICE_RE.test(code);

/** What each practice code simulates, for the briefing sheet (ID, NL). */
export const PRACTICE_SCENARIOS: Record<(typeof PRACTICE_CODES)[number], { id: string; nl: string }> = {
  "PPME-LATIHAN-01": { id: "Tamu tunggal, tiket sah (hijau)", nl: "Enkele gast, geldig ticket (groen)" },
  "PPME-LATIHAN-02": { id: "Keluarga 3 orang, tiket sah (hijau)", nl: "Gezin van 3, geldig ticket (groen)" },
  "PPME-LATIHAN-03": { id: "Sudah check-in (scan ganda)", nl: "Al ingecheckt (dubbele scan)" },
  "PPME-LATIHAN-04": { id: "Tiket dibatalkan", nl: "Ticket geannuleerd" },
  "PPME-LATIHAN-05": { id: "Kode tidak dikenal", nl: "Onbekende code" },
  "PPME-LATIHAN-06": { id: "Pendaftaran tidak diterima", nl: "Registratie niet geaccepteerd" },
  "PPME-LATIHAN-07": { id: "Pintu belum dibuka (kuning, hanya ketua tim)", nl: "Poort nog niet open (geel, alleen teamleider)" },
  "PPME-LATIHAN-08": { id: "Tiket sendiri (tidak boleh scan)", nl: "Eigen ticket (niet scannen)" },
  "PPME-LATIHAN-09": { id: "Anak kecil dengan keluarga (hijau)", nl: "Klein kind met gezin (groen)" },
};

export interface GroupMember {
  id: string;
  name: string;
  ageGroup: AgeGroup;
  state: "inside" | "ready" | "blocked";
  insideAt?: string;
}

export interface FirstScan {
  at: string;
  by: string | null;
  device: string | null;
}

export interface LookupResult {
  verdict: Verdict;
  reason: ReasonCode | null;
  /** A lead may let an amber verdict through (gate closed). Red is final. */
  overridable: boolean;
  /** Same scanner scanned the same person seconds ago: show a calm note, not an alarm. */
  soft?: boolean;
  practice?: boolean;
  gate: GateState;
  person?: { id: string; name: string; ageGroup: AgeGroup };
  group?: GroupMember[];
  inside?: number;
  total?: number;
  first?: FirstScan;
}

const practiceGroup = (people: [string, AgeGroup][], state: GroupMember["state"] = "ready"): GroupMember[] =>
  people.map(([name, ageGroup], i) => ({ id: `practice-${i}-${name}`, name, ageGroup, state }));

function practiceLookup(code: string, gate: GateState): LookupResult {
  const base = { practice: true as const, gate };
  switch (code) {
    case "PPME-LATIHAN-01": {
      const group = practiceGroup([["Aisyah D.", "dewasa"]]);
      return { ...base, verdict: "green", reason: null, overridable: false, person: pick(group, 0), group, inside: 0, total: 1 };
    }
    case "PPME-LATIHAN-02": {
      const group = practiceGroup([
        ["Budi S.", "dewasa"],
        ["Siti S.", "dewasa"],
        ["Rizky S.", "anak"],
      ]);
      return { ...base, verdict: "green", reason: null, overridable: false, person: pick(group, 0), group, inside: 0, total: 3 };
    }
    case "PPME-LATIHAN-03":
      return {
        ...base,
        verdict: "red",
        reason: "already_in",
        overridable: false,
        person: { id: "practice-dup", name: "Fatimah A.", ageGroup: "dewasa" },
        first: { at: new Date(Date.now() - 4 * 60_000).toISOString(), by: "Latihan", device: "iPhone Safari" },
        inside: 1,
        total: 1,
      };
    case "PPME-LATIHAN-04":
      return { ...base, verdict: "red", reason: "ticket_revoked", overridable: false };
    case "PPME-LATIHAN-05":
      return { ...base, verdict: "red", reason: "unknown_code", overridable: false };
    case "PPME-LATIHAN-06":
      return { ...base, verdict: "red", reason: "not_accepted", overridable: false };
    case "PPME-LATIHAN-07": {
      const group = practiceGroup([["Umar H.", "dewasa"]]);
      return { ...base, verdict: "amber", reason: "gate_before", overridable: true, person: pick(group, 0), group, inside: 0, total: 1 };
    }
    case "PPME-LATIHAN-08":
      return { ...base, verdict: "red", reason: "own_ticket", overridable: false };
    default: {
      const group = practiceGroup([
        ["Hana P.", "dewasa"],
        ["Zaid P.", "balita"],
      ]);
      return { ...base, verdict: "green", reason: null, overridable: false, person: pick(group, 1), group, inside: 0, total: 2 };
    }
  }
}

function pick(group: GroupMember[], i: number) {
  const m = group[i];
  return { id: m.id, name: m.name, ageGroup: m.ageGroup };
}

// ---------------------------------------------------------------- helpers

/** "Aisyah Dahlan" -> "Aisyah D." (privacy: enough to recognise the person, never the full name). */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  const last = [...parts[parts.length - 1]][0]?.toLocaleUpperCase("id") ?? "";
  return `${parts[0]} ${last}.`;
}

export const scannerLabel = (s: Pick<ScannerIdentity, "name" | "email">) => s.name?.trim() || s.email;
export const scannerActor = (s: Pick<ScannerIdentity, "id">) => `scanner:${s.id}`;

interface TicketRow {
  id: string;
  registration_id: string;
  full_name: string;
  age_group: AgeGroup;
  pstatus: string;
  checked_in_at: string | null;
  checked_in_by: string | null;
  event_id: number;
  rstatus: string;
  payment_status: string;
  email: string | null;
}

type LogAction = "admit" | "deny" | "duplicate" | "invalid" | "blocked" | "undo" | "override" | "escalate" | "admin_admit" | "admin_undo";

function logStatement(
  db: D1Database,
  scanner: ScannerIdentity | null,
  nowIso: string,
  row: {
    action: LogAction;
    eventId?: number | null;
    participantId?: string | null;
    registrationId?: string | null;
    reason?: string | null;
    requestId?: string | null;
    detail?: unknown;
    actorLabel?: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO checkin_log (at, event_id, participant_id, registration_id, scanner_id, scanner_label, device_label, action, reason, request_id, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      nowIso,
      row.eventId ?? null,
      row.participantId ?? null,
      row.registrationId ?? null,
      scanner?.id ?? null,
      scanner ? scannerLabel(scanner) : (row.actorLabel ?? null),
      scanner?.deviceLabel ?? null,
      row.action,
      row.reason ?? null,
      row.requestId ?? null,
      row.detail === undefined ? null : JSON.stringify(row.detail),
    );
}

async function firstScan(db: D1Database, participantId: string, at: string, by: string | null): Promise<FirstScan> {
  const log = await db
    .prepare(
      `SELECT scanner_label, device_label FROM checkin_log
       WHERE participant_id = ? AND action IN ('admit', 'override', 'admin_admit') ORDER BY id DESC LIMIT 1`,
    )
    .bind(participantId)
    .first<{ scanner_label: string | null; device_label: string | null }>();
  return { at, by: log?.scanner_label ?? (by && !by.startsWith("scanner:") ? by : null), device: log?.device_label ?? null };
}

async function recentBadScans(db: D1Database, scanner: ScannerIdentity, now: Date) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM checkin_log WHERE scanner_id = ? AND at > ? AND action IN ('invalid', 'blocked', 'duplicate')`,
    )
    .bind(scanner.id, new Date(now.getTime() - 60_000).toISOString())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ---------------------------------------------------------------- lookup (read-only verdict)

export type LookupOutcome = LookupResult | { rateLimited: true };

export async function lookupTicket(
  db: D1Database,
  event: EventRow,
  scanner: ScannerIdentity,
  rawCode: string,
  now = new Date(),
): Promise<LookupOutcome> {
  const code = rawCode.trim().toUpperCase();
  const nowIso = now.toISOString();
  const gate = gateState(event, now);

  if (isPracticeCode(code)) return practiceLookup(code, gate);

  const log = (row: Parameters<typeof logStatement>[3]) => logStatement(db, scanner, nowIso, { eventId: event.id, ...row }).run();

  // Enumeration/abuse guard: a flood of bad scans from one session is stopped (a code is 128 bits, this is for bugs and abuse).
  if ((await recentBadScans(db, scanner, now)) >= LOOKUPS_PER_MINUTE) return { rateLimited: true };

  if (!TICKET_TOKEN_PATTERN.test(code)) {
    await log({ action: "invalid", reason: "unknown_code", detail: { len: code.length } });
    return { verdict: "red", reason: "unknown_code", overridable: false, gate };
  }

  const row = await db
    .prepare(
      `SELECT p.id, p.registration_id, p.full_name, p.age_group, p.status AS pstatus, p.checked_in_at, p.checked_in_by,
              r.event_id, r.status AS rstatus, r.payment_status, r.email
       FROM participants p JOIN registrations r ON r.id = p.registration_id WHERE p.qr_token = ?`,
    )
    .bind(code)
    .first<TicketRow>();

  if (!row) {
    const revoked = await db.prepare("SELECT 1 AS x FROM revoked_tickets WHERE code = ?").bind(code).first();
    const reason: ReasonCode = revoked ? "ticket_revoked" : "unknown_code";
    await log({ action: revoked ? "blocked" : "invalid", reason, detail: { head: code.slice(0, 4) } });
    return { verdict: "red", reason, overridable: false, gate };
  }

  const person = { id: row.id, name: shortName(row.full_name), ageGroup: row.age_group };
  const fail = async (reason: ReasonCode, extra: Partial<LookupResult> = {}, logAction: LogAction = "blocked", doLog = true): Promise<LookupResult> => {
    if (doLog) await log({ action: logAction, reason, participantId: row.id, registrationId: row.registration_id });
    return { verdict: "red", reason, overridable: false, gate, person, ...extra };
  };

  if (row.event_id !== event.id) return fail("wrong_event");
  const own =
    (!!row.email && row.email.toLowerCase() === scanner.email) || (!!scanner.participantId && scanner.participantId === row.id);
  if (own) return fail("own_ticket");
  if (!event.checkin_enabled) return fail("checkin_off");
  if (row.pstatus !== "accepted" || row.rstatus !== "accepted") return fail("not_accepted");
  if (!["free", "paid", "manual"].includes(row.payment_status)) return fail("payment_unclear");

  const { results } = await db
    .prepare(
      `SELECT id, full_name, age_group, checked_in_at FROM participants
       WHERE registration_id = ? AND status = 'accepted' AND qr_token IS NOT NULL ORDER BY position`,
    )
    .bind(row.registration_id)
    .all<{ id: string; full_name: string; age_group: AgeGroup; checked_in_at: string | null }>();
  const group: GroupMember[] = results.map((m) => ({
    id: m.id,
    name: shortName(m.full_name),
    ageGroup: m.age_group,
    state: m.checked_in_at ? "inside" : "ready",
    insideAt: m.checked_in_at ?? undefined,
  }));
  const counts = { inside: group.filter((m) => m.state === "inside").length, total: group.length };

  if (row.checked_in_at) {
    const first = await firstScan(db, row.id, row.checked_in_at, row.checked_in_by);
    const soft =
      row.checked_in_by === scannerActor(scanner) && now.getTime() - Date.parse(row.checked_in_at) < SOFT_RESCAN_MS;
    if (!soft) await log({ action: "duplicate", reason: "already_in", participantId: row.id, registrationId: row.registration_id });
    return { verdict: "red", reason: "already_in", overridable: false, soft, gate, person, group, first, ...counts };
  }

  if (gate === "before" || gate === "after") {
    return {
      verdict: "amber",
      reason: gate === "before" ? "gate_before" : "gate_after",
      overridable: scanner.role === "lead",
      gate,
      person,
      group,
      ...counts,
    };
  }
  return { verdict: "green", reason: null, overridable: false, gate, person, group, ...counts };
}

// ---------------------------------------------------------------- admit (the atomic step)

export interface AdmitItem {
  id: string;
  status: "admitted" | "duplicate" | "blocked";
  reason?: ReasonCode;
  first?: FirstScan;
}

export type AdmitOutcome = { ok: true; items: AdmitItem[] } | { ok: false; message: "bad_request" };

export async function admitParticipants(
  db: D1Database,
  event: EventRow,
  scanner: ScannerIdentity,
  input: { participantIds: string[]; requestId: string; override?: boolean },
  now = new Date(),
): Promise<AdmitOutcome> {
  const ids = [...new Set(input.participantIds)].filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64);
  if (ids.length === 0 || ids.length > MAX_ADMIT_BATCH || !/^[\w-]{8,64}$/.test(input.requestId)) {
    return { ok: false, message: "bad_request" };
  }

  // Practice: simulate, write nothing.
  if (ids.every((id) => id.startsWith("practice-"))) {
    return { ok: true, items: ids.map((id) => ({ id, status: "admitted" as const })) };
  }
  if (ids.some((id) => id.startsWith("practice-"))) return { ok: false, message: "bad_request" };

  const nowIso = now.toISOString();
  const { opens, closes } = gateWindow(event);
  const override = !!input.override && scanner.role === "lead";

  // Idempotent retry: the same request id already admitted these people (lost response on a bad connection).
  const { results: replay } = await db
    .prepare(
      `SELECT participant_id FROM checkin_log WHERE request_id = ? AND action IN ('admit', 'override') AND scanner_id = ?`,
    )
    .bind(input.requestId, scanner.id)
    .all<{ participant_id: string }>();
  const done = new Set(replay.map((r) => r.participant_id));

  const todo = ids.filter((id) => !done.has(id));
  const statements: D1PreparedStatement[] = [];
  for (const id of todo) {
    statements.push(
      db
        .prepare(
          `UPDATE participants SET checked_in_at = ?, checked_in_by = ?
           WHERE id = ? AND checked_in_at IS NULL AND status = 'accepted' AND qr_token IS NOT NULL
             AND participants.id IS NOT ?
             AND EXISTS (SELECT 1 FROM registrations r JOIN events e ON e.id = r.event_id
                         WHERE r.id = participants.registration_id AND r.event_id = ? AND r.status = 'accepted'
                           AND r.payment_status IN ${PAID_OK} AND e.checkin_enabled = 1
                           AND (? = 1 OR (? >= ? AND ? <= ?))
                           AND (r.email IS NULL OR lower(r.email) <> ?))`,
        )
        .bind(nowIso, scannerActor(scanner), id, scanner.participantId, event.id, override ? 1 : 0, nowIso, opens, nowIso, closes, scanner.email),
      db
        .prepare(
          `INSERT INTO checkin_log (at, event_id, participant_id, registration_id, scanner_id, scanner_label, device_label, action, reason, request_id)
           SELECT ?, ?, p.id, p.registration_id, ?, ?, ?, ?, ?, ? FROM participants p
           WHERE p.id = ? AND p.checked_in_at = ? AND p.checked_in_by = ?`,
        )
        .bind(
          nowIso,
          event.id,
          scanner.id,
          scannerLabel(scanner),
          scanner.deviceLabel,
          override && (nowIso < opens || nowIso > closes) ? "override" : "admit",
          override && (nowIso < opens || nowIso > closes) ? (nowIso < opens ? "gate_before" : "gate_after") : null,
          input.requestId,
          id,
          nowIso,
          scannerActor(scanner),
        ),
    );
  }
  const results = statements.length ? await db.batch(statements) : [];

  const items: AdmitItem[] = [];
  for (const id of ids) {
    if (done.has(id)) {
      items.push({ id, status: "admitted" });
      continue;
    }
    const i = todo.indexOf(id);
    if ((results[i * 2].meta.changes ?? 0) === 1) {
      items.push({ id, status: "admitted" });
      continue;
    }
    // Lost: explain why with a fresh read, and log it.
    const lookup = await explainFailure(db, event, scanner, id, now);
    items.push(lookup);
  }
  return { ok: true, items };
}

async function explainFailure(db: D1Database, event: EventRow, scanner: ScannerIdentity, id: string, now: Date): Promise<AdmitItem> {
  const nowIso = now.toISOString();
  const row = await db
    .prepare(
      `SELECT p.id, p.registration_id, p.status AS pstatus, p.checked_in_at, p.checked_in_by,
              r.event_id, r.status AS rstatus, r.payment_status, r.email
       FROM participants p JOIN registrations r ON r.id = p.registration_id WHERE p.id = ?`,
    )
    .bind(id)
    .first<Pick<TicketRow, "id" | "registration_id" | "pstatus" | "checked_in_at" | "checked_in_by" | "event_id" | "rstatus" | "payment_status" | "email">>();
  if (!row) return { id, status: "blocked", reason: "unknown_code" };
  if (row.checked_in_at) {
    const first = await firstScan(db, id, row.checked_in_at, row.checked_in_by);
    await logStatement(db, scanner, nowIso, {
      action: "duplicate",
      reason: "already_in",
      eventId: event.id,
      participantId: id,
      registrationId: row.registration_id,
    }).run();
    return { id, status: "duplicate", reason: "already_in", first };
  }
  const own = (!!row.email && row.email.toLowerCase() === scanner.email) || scanner.participantId === id;
  const reason: ReasonCode = own
    ? "own_ticket"
    : row.event_id !== event.id
      ? "wrong_event"
      : !event.checkin_enabled
        ? "checkin_off"
        : row.pstatus !== "accepted" || row.rstatus !== "accepted"
          ? "not_accepted"
          : !["free", "paid", "manual"].includes(row.payment_status)
            ? "payment_unclear"
            : gateState(event, now) === "before"
              ? "gate_before"
              : "gate_after";
  await logStatement(db, scanner, nowIso, {
    action: "blocked",
    reason,
    eventId: event.id,
    participantId: id,
    registrationId: row.registration_id,
  }).run();
  return { id, status: "blocked", reason };
}

// ---------------------------------------------------------------- deny, escalate, undo

export function parseDenyReason(value: unknown): DenyReason {
  return DENY_REASONS.includes(value as DenyReason) ? (value as DenyReason) : "other";
}

/** Records that a scanner refused entry (the ticket itself is not changed). */
export async function recordDeny(
  db: D1Database,
  event: EventRow,
  scanner: ScannerIdentity,
  input: { participantId: string | null; reason: DenyReason; requestId: string },
  now = new Date(),
) {
  if (input.participantId?.startsWith("practice-")) return;
  await logStatement(db, scanner, now.toISOString(), {
    action: "deny",
    reason: input.reason,
    eventId: event.id,
    participantId: input.participantId,
    requestId: /^[\w-]{8,64}$/.test(input.requestId) ? input.requestId : null,
  })
    .run()
    .catch(() => undefined); // a retried tap hits the unique request index: already recorded
}

export async function recordEscalation(
  db: D1Database,
  event: EventRow,
  scanner: ScannerIdentity,
  input: { level: 1 | 2 | 3; participantId: string | null; reasonCode: string | null },
  now = new Date(),
) {
  if (input.participantId?.startsWith("practice-")) return;
  await logStatement(db, scanner, now.toISOString(), {
    action: "escalate",
    reason: input.reasonCode?.slice(0, 40) ?? null,
    eventId: event.id,
    participantId: input.participantId,
    detail: { level: input.level },
  }).run();
}

export type UndoResult = { ok: true } | { ok: false; reason: "not_inside" | "not_allowed" | "practice" };

/** Scanner: own entry within 2 minutes. Lead: any entry. */
export async function undoCheckin(
  db: D1Database,
  event: EventRow,
  scanner: ScannerIdentity,
  participantId: string,
  now = new Date(),
): Promise<UndoResult> {
  if (participantId.startsWith("practice-")) return { ok: true };
  const nowIso = now.toISOString();
  const row = await db
    .prepare("SELECT registration_id, checked_in_at, checked_in_by FROM participants WHERE id = ?")
    .bind(participantId)
    .first<{ registration_id: string; checked_in_at: string | null; checked_in_by: string | null }>();
  if (!row?.checked_in_at) return { ok: false, reason: "not_inside" };
  const mine = row.checked_in_by === scannerActor(scanner);
  const recent = now.getTime() - Date.parse(row.checked_in_at) <= UNDO_WINDOW_MS;
  if (scanner.role !== "lead" && !(mine && recent)) return { ok: false, reason: "not_allowed" };

  const res = await db.batch([
    db
      .prepare(`UPDATE participants SET checked_in_at = NULL, checked_in_by = NULL WHERE id = ? AND checked_in_at = ?`)
      .bind(participantId, row.checked_in_at),
    logStatement(db, scanner, nowIso, {
      action: "undo",
      eventId: event.id,
      participantId,
      registrationId: row.registration_id,
      detail: { was: row.checked_in_at },
    }),
  ]);
  if ((res[0].meta.changes ?? 0) !== 1) return { ok: false, reason: "not_inside" };
  return { ok: true };
}

// ---------------------------------------------------------------- admin (info desk) check-in

export type AdminCheckinResult = { ok: true; message: string } | { ok: false; message: string };

/** Info desk: check a person in by hand (lost QR, scanner volunteers themselves). Needs an accepted registration; ignores the gate. */
export async function adminCheckin(
  db: D1Database,
  actor: string,
  participantId: string,
  now = new Date(),
): Promise<AdminCheckinResult> {
  const nowIso = now.toISOString();
  const res = await db.batch([
    db
      .prepare(
        `UPDATE participants SET checked_in_at = ?, checked_in_by = ?
         WHERE id = ? AND checked_in_at IS NULL AND status = 'accepted'
           AND EXISTS (SELECT 1 FROM registrations r WHERE r.id = participants.registration_id AND r.status = 'accepted'
                       AND r.payment_status IN ${PAID_OK})`,
      )
      .bind(nowIso, actor, participantId),
    db
      .prepare(
        `INSERT INTO checkin_log (at, event_id, participant_id, registration_id, scanner_label, action)
         SELECT ?, r.event_id, p.id, p.registration_id, ?, 'admin_admit' FROM participants p JOIN registrations r ON r.id = p.registration_id
         WHERE p.id = ? AND p.checked_in_at = ? AND p.checked_in_by = ?`,
      )
      .bind(nowIso, actor, participantId, nowIso, actor),
  ]);
  if ((res[0].meta.changes ?? 0) === 1) return { ok: true, message: "Peserta ditandai sudah check-in." };
  const row = await db
    .prepare("SELECT checked_in_at FROM participants WHERE id = ?")
    .bind(participantId)
    .first<{ checked_in_at: string | null }>();
  if (row?.checked_in_at) return { ok: false, message: "Peserta ini sudah check-in." };
  return { ok: false, message: "Tidak dapat check-in: pendaftaran belum diterima atau pembayaran belum dikonfirmasi." };
}

export async function adminUndoCheckin(
  db: D1Database,
  actor: string,
  participantId: string,
  now = new Date(),
): Promise<AdminCheckinResult> {
  const nowIso = now.toISOString();
  const row = await db
    .prepare(
      `SELECT p.registration_id, p.checked_in_at, r.event_id FROM participants p JOIN registrations r ON r.id = p.registration_id WHERE p.id = ?`,
    )
    .bind(participantId)
    .first<{ registration_id: string; checked_in_at: string | null; event_id: number }>();
  if (!row?.checked_in_at) return { ok: false, message: "Peserta ini belum check-in." };
  const res = await db.batch([
    db.prepare("UPDATE participants SET checked_in_at = NULL, checked_in_by = NULL WHERE id = ? AND checked_in_at = ?").bind(participantId, row.checked_in_at),
    logStatement(db, null, nowIso, {
      action: "admin_undo",
      eventId: row.event_id,
      participantId,
      registrationId: row.registration_id,
      actorLabel: actor,
      detail: { was: row.checked_in_at },
    }),
    auditStatement(db, actor, "checkin.undo", row.registration_id, { participantId }, nowIso),
  ]);
  if ((res[0].meta.changes ?? 0) !== 1) return { ok: false, message: "Status check-in sudah berubah. Muat ulang halaman." };
  return { ok: true, message: "Check-in dibatalkan." };
}

// ---------------------------------------------------------------- numbers

export interface CheckinStats {
  expected: number;
  inside: number;
  byAge: Record<AgeGroup, { expected: number; inside: number }>;
}

/** People with a valid ticket (accepted, QR issued) and how many are inside. */
export async function checkinStats(db: D1Database, eventId: number): Promise<CheckinStats> {
  const { results } = await db
    .prepare(
      `SELECT p.age_group AS age, COUNT(*) AS expected, SUM(CASE WHEN p.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS inside
       FROM participants p JOIN registrations r ON r.id = p.registration_id
       WHERE r.event_id = ? AND r.status = 'accepted' AND p.status = 'accepted' AND p.qr_token IS NOT NULL
       GROUP BY p.age_group`,
    )
    .bind(eventId)
    .all<{ age: AgeGroup; expected: number; inside: number | null }>();
  const byAge = {
    balita: { expected: 0, inside: 0 },
    anak: { expected: 0, inside: 0 },
    remaja: { expected: 0, inside: 0 },
    dewasa: { expected: 0, inside: 0 },
  } as CheckinStats["byAge"];
  let expected = 0;
  let inside = 0;
  for (const r of results) {
    byAge[r.age] = { expected: r.expected, inside: r.inside ?? 0 };
    expected += r.expected;
    inside += r.inside ?? 0;
  }
  return { expected, inside, byAge };
}

// ---------------------------------------------------------------- retention (anonymise after the event)

export const CHECKIN_RETENTION_DAYS = 30;

/**
 * Event end + 30 days: the check-in log keeps counts, times and outcomes but loses who and where
 * (scanner label -> 'scanner-<id>', device label cleared), scanner sessions and self-test details are deleted.
 * Idempotent; returns the number of log rows anonymised.
 */
export async function anonymiseCheckinData(db: D1Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CHECKIN_RETENTION_DAYS * 86_400_000).toISOString();
  const due = await db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE ends_at < ?")
    .bind(cutoff)
    .first<{ n: number }>();
  if (!due?.n) return 0;
  const res = await db.batch([
    db
      .prepare(
        `UPDATE checkin_log SET scanner_label = CASE WHEN scanner_id IS NULL THEN NULL ELSE 'scanner-' || scanner_id END, device_label = NULL
         WHERE event_id IN (SELECT id FROM events WHERE ends_at < ?)
           AND (device_label IS NOT NULL OR (scanner_label IS NOT NULL AND scanner_label NOT LIKE 'scanner-%'))`,
      )
      .bind(cutoff),
    db.prepare("DELETE FROM scanner_sessions WHERE created_at < ?").bind(cutoff),
    db.prepare("DELETE FROM scanner_selftests WHERE at < ?").bind(cutoff),
  ]);
  return res[0].meta.changes ?? 0;
}
