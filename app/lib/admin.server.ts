import { AGE_GROUPS, localDateKey } from "./format";
import type { EventRow, RegistrationRow } from "./db.server";
import { quotaSummary } from "./registration.server";

export interface RegistrationFilters {
  q?: string;
  /** "unsent" = the email this registration is waiting for has not gone out (see unsentEmailSql). */
  email?: string;
  status?: string;
  member?: "1" | "0" | "";
  source?: "online" | "manual" | "";
  page?: number;
}

export const PAGE_SIZE = 25;

/** Effective status: a pending registration past its deadline counts as expired even before the cron runs (B3). */
export const EFFECTIVE_STATUS_SQL = `CASE WHEN r.status = 'pending_payment' AND r.pay_deadline <= ? THEN 'expired' ELSE r.status END`;

/** Emails older than this that are still not sent count as "stuck" (gives the fast path and cron time). */
export const UNSENT_GRACE_MS = 5 * 60_000;

/**
 * Registrations whose required email is not 'sent' yet: confirmation (accepted), payment instructions
 * (pending payment) or expiry notice (expired). Covers rows that are pending/failed AND rows with no email_log row.
 * Manual registrations are excluded (the system sends them nothing). Binds: cut, cut, cut.
 */
export function unsentEmailSql(cutIso: string) {
  const notSent = (kind: string) =>
    `NOT EXISTS (SELECT 1 FROM email_log l WHERE l.registration_id = r.id AND l.kind = '${kind}' AND l.status = 'sent')`;
  return {
    sql: `(r.source = 'online' AND r.email IS NOT NULL AND (
      (r.status = 'accepted' AND COALESCE(r.paid_at, r.created_at) <= ? AND ${notSent("confirmation")})
      OR (r.status = 'pending_payment' AND r.created_at <= ? AND ${notSent("payment_instructions")})
      OR (r.status = 'expired' AND r.pay_deadline <= ? AND ${notSent("expired")})))`,
    binds: [cutIso, cutIso, cutIso],
  };
}

function whereClause(eventId: number, f: RegistrationFilters, nowIso: string) {
  const where: string[] = ["r.event_id = ?"];
  const binds: unknown[] = [eventId];
  if (f.q) {
    where.push(
      `(r.registrant_name LIKE ? OR r.email LIKE ? OR r.whatsapp LIKE ? OR r.payment_code LIKE ?
        OR EXISTS (SELECT 1 FROM participants p WHERE p.registration_id = r.id AND p.full_name LIKE ?))`,
    );
    const like = `%${f.q.trim()}%`;
    binds.push(like, like, like, like, like);
  }
  if (f.status) {
    where.push(`${EFFECTIVE_STATUS_SQL} = ?`);
    binds.push(nowIso, f.status);
  }
  if (f.email === "unsent") {
    const unsent = unsentEmailSql(new Date(Date.parse(nowIso) - UNSENT_GRACE_MS).toISOString());
    where.push(unsent.sql);
    binds.push(...unsent.binds);
  }
  if (f.member === "1" || f.member === "0") {
    where.push("r.is_member = ?");
    binds.push(Number(f.member));
  }
  if (f.source) {
    where.push("r.source = ?");
    binds.push(f.source);
  }
  return { sql: where.join(" AND "), binds };
}

export type RegistrationListRow = RegistrationRow & { effective_status: string; checked_in: number };

export async function listRegistrations(db: D1Database, event: EventRow, f: RegistrationFilters, now = new Date()) {
  const nowIso = now.toISOString();
  const { sql, binds } = whereClause(event.id, f, nowIso);
  const page = Math.max(1, f.page ?? 1);
  const [{ results }, count] = await Promise.all([
    db
      .prepare(
        `SELECT r.*, ${EFFECTIVE_STATUS_SQL} AS effective_status,
           (SELECT COUNT(*) FROM participants p WHERE p.registration_id = r.id AND p.checked_in_at IS NOT NULL) AS checked_in
         FROM registrations r WHERE ${sql}
         ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(nowIso, ...binds, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .all<RegistrationListRow>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM registrations r WHERE ${sql}`)
      .bind(...binds)
      .first<{ n: number }>(),
  ]);
  return { rows: results, total: count?.n ?? 0, page, pageSize: PAGE_SIZE };
}

/** One point per Netherlands calendar day from the first registration to today (gaps filled with zeros). */
export function buildTimeline(rows: { created_at: string; is_member: number; people: number }[], now: Date) {
  if (rows.length === 0) return [] as { date: string; member: number; nonMember: number }[];
  const byDay = new Map<string, { member: number; nonMember: number }>();
  for (const r of rows) {
    const k = localDateKey(r.created_at);
    const d = byDay.get(k) ?? { member: 0, nonMember: 0 };
    if (r.is_member) d.member += r.people;
    else d.nonMember += r.people;
    byDay.set(k, d);
  }
  const first = localDateKey(rows[0].created_at);
  const last = localDateKey(now);
  const out: { date: string; member: number; nonMember: number }[] = [];
  for (let t = Date.parse(first + "T12:00:00Z"); out.length < 400; t += 86_400_000) {
    const k = new Date(t).toISOString().slice(0, 10);
    if (k > last && out.length > 0) break;
    out.push({ date: k, ...(byDay.get(k) ?? { member: 0, nonMember: 0 }) });
  }
  return out;
}

export async function dashboardStats(db: D1Database, event: EventRow, now = new Date()) {
  const nowIso = now.toISOString();
  const byStatus = await db
    .prepare(
      `SELECT ${EFFECTIVE_STATUS_SQL} AS status, COUNT(*) AS families, SUM(r.people) AS people
       FROM registrations r WHERE r.event_id = ? GROUP BY 1`,
    )
    .bind(nowIso, event.id)
    .all<{ status: string; families: number; people: number }>();

  const bySource = await db
    .prepare(
      `SELECT r.source, SUM(r.people) AS people FROM registrations r
       WHERE r.event_id = ? AND r.status = 'accepted' GROUP BY r.source`,
    )
    .bind(event.id)
    .all<{ source: string; people: number }>();

  const checkin = await db
    .prepare(
      `SELECT COUNT(*) AS accepted, SUM(CASE WHEN p.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in
       FROM participants p JOIN registrations r ON r.id = p.registration_id
       WHERE r.event_id = ? AND p.status = 'accepted'`,
    )
    .bind(event.id)
    .first<{ accepted: number; checked_in: number | null }>();

  const pending = await db
    .prepare(
      `SELECT * FROM registrations WHERE event_id = ? AND status = 'pending_payment' AND pay_deadline > ?
       ORDER BY pay_deadline ASC`,
    )
    .bind(event.id, nowIso)
    .all<RegistrationRow>();

  const unverified = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM registrations
       WHERE event_id = ? AND is_member = 1 AND status = 'accepted' AND membership_verified_at IS NULL`,
    )
    .bind(event.id)
    .first<{ n: number }>();

  const unsent = unsentEmailSql(new Date(now.getTime() - UNSENT_GRACE_MS).toISOString());
  const unsentRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM registrations r WHERE r.event_id = ? AND ${unsent.sql}`)
    .bind(event.id, ...unsent.binds)
    .first<{ n: number }>();

  // Daily registrations (people) per group, Netherlands calendar days, active registrations only.
  const regRows = await db
    .prepare(
      `SELECT r.created_at, r.is_member, r.people FROM registrations r
       WHERE r.event_id = ? AND (r.status = 'accepted' OR (r.status = 'pending_payment' AND r.pay_deadline > ?))
       ORDER BY r.created_at`,
    )
    .bind(event.id, nowIso)
    .all<{ created_at: string; is_member: number; people: number }>();
  const timeline = buildTimeline(regRows.results, now);

  const ageRows = await db
    .prepare(
      `SELECT p.age_group, r.is_member, COUNT(*) AS n FROM participants p JOIN registrations r ON r.id = p.registration_id
       WHERE r.event_id = ? AND (r.status = 'accepted' OR (r.status = 'pending_payment' AND r.pay_deadline > ?))
       GROUP BY p.age_group, r.is_member`,
    )
    .bind(event.id, nowIso)
    .all<{ age_group: string; is_member: number; n: number }>();
  const ageGroups = AGE_GROUPS.map((g) => ({
    group: g,
    member: ageRows.results.find((a) => a.age_group === g && a.is_member === 1)?.n ?? 0,
    nonMember: ageRows.results.find((a) => a.age_group === g && a.is_member === 0)?.n ?? 0,
  }));

  const statuses: Record<string, { families: number; people: number }> = {};
  for (const s of byStatus.results) statuses[s.status] = { families: s.families, people: s.people ?? 0 };

  return {
    statuses,
    bySource: Object.fromEntries(bySource.results.map((s) => [s.source, s.people ?? 0])) as Record<string, number>,
    checkin: { accepted: checkin?.accepted ?? 0, checkedIn: checkin?.checked_in ?? 0 },
    quota: await quotaSummary(db, event, now),
    timeline,
    ageGroups,
    pendingPayments: pending.results,
    unverifiedMembers: unverified?.n ?? 0,
    unsentEmails: unsentRow?.n ?? 0,
  };
}

export async function emailLogFor(db: D1Database, registrationId: string) {
  const { results } = await db
    .prepare("SELECT * FROM email_log WHERE registration_id = ? ORDER BY updated_at DESC")
    .bind(registrationId)
    .all<{ kind: string; status: string; attempts: number; sent_at: string | null; last_error: string | null; updated_at: string }>();
  return results;
}

export async function auditFor(db: D1Database, target: string) {
  const { results } = await db
    .prepare("SELECT * FROM audit_log WHERE target = ? ORDER BY id DESC LIMIT 50")
    .bind(target)
    .all<{ at: string; actor: string; action: string; detail: string | null }>();
  return results;
}

/** One row per participant with its registration: the format the committee asked for (FR-ADM-16). */
export async function exportRows(db: D1Database, event: EventRow, f: RegistrationFilters, now = new Date()) {
  const nowIso = now.toISOString();
  const { sql, binds } = whereClause(event.id, f, nowIso);
  const { results } = await db
    .prepare(
      `SELECT r.id AS registration_id, r.created_at, r.registrant_name, r.email, r.whatsapp,
         CASE r.is_member WHEN 1 THEN 'member' ELSE 'non_member' END AS category,
         r.source, ${EFFECTIVE_STATUS_SQL} AS registration_status, r.payment_status, r.payment_code,
         r.amount_cents, r.pay_deadline, r.paid_at, r.confirmed_by,
         r.membership_verified_at, r.membership_verified_by,
         p.id AS participant_id, p.position, p.full_name, p.age_group, p.gender,
         p.status AS participant_status, p.qr_token AS ticket_code, p.checked_in_at
       FROM registrations r JOIN participants p ON p.registration_id = r.id
       WHERE ${sql}
       ORDER BY r.created_at, p.position`,
    )
    .bind(nowIso, ...binds)
    .all<Record<string, unknown>>();
  return results;
}
