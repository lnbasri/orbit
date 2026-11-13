// Row types and small query helpers shared by the server modules.

export interface EventRow {
  id: number;
  slug: string;
  title: string;
  speaker: string | null;
  theme: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  quota_member: number;
  quota_non_member: number;
  price_non_member_cents: number;
  max_family: number;
  pay_window_min: number;
  reminder_after_min: number;
  payment_prefix: string;
  payment_counter: number;
  privacy_version: string;
  info_url: string | null;
  status: "draft" | "open" | "closed";
}

export type RegistrationStatus = "accepted" | "pending_payment" | "expired" | "rejected_quota";

export interface RegistrationRow {
  id: string;
  event_id: number;
  created_at: string;
  registrant_name: string;
  is_member: number;
  email: string | null;
  whatsapp: string | null;
  people: number;
  source: "online" | "manual";
  status: RegistrationStatus;
  payment_status: string;
  payment_code: string | null;
  amount_cents: number;
  pay_deadline: string | null;
  paid_at: string | null;
  confirmed_by: string | null;
  membership_verified_at: string | null;
  membership_verified_by: string | null;
  consent_at: string | null;
  privacy_version: string | null;
  marketing_opt_in: number;
  idempotency_key: string | null;
  notes: string | null;
  /** Random revision written by every self-service edit (null = never edited). */
  edit_rev: string | null;
  updated_at: string | null;
}

export interface ParticipantRow {
  id: string;
  registration_id: string;
  position: number;
  full_name: string;
  age_group: "anak" | "remaja" | "dewasa";
  gender: "laki-laki" | "perempuan" | null;
  status: "accepted" | "pending_payment" | "expired" | "rejected";
  qr_token: string | null;
  checked_in_at: string | null;
  checked_in_by: string | null;
}

export async function getEventBySlug(db: D1Database, slug: string) {
  return db.prepare("SELECT * FROM events WHERE slug = ?").bind(slug).first<EventRow>();
}

export async function getEventById(db: D1Database, id: number) {
  return db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
}

export async function getRegistration(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM registrations WHERE id = ?").bind(id).first<RegistrationRow>();
}

export async function getParticipants(db: D1Database, registrationId: string) {
  const { results } = await db
    .prepare("SELECT * FROM participants WHERE registration_id = ? ORDER BY position")
    .bind(registrationId)
    .all<ParticipantRow>();
  return results;
}

/**
 * Seats held in one quota group: online registrations that are accepted, or pending with a
 * deadline still in the future. Manual registrations never count (decision 11 Nov 2026).
 * Expects binds: event_id, is_member, now.
 */
export const SEATS_USED_SQL = `
  SELECT COALESCE(SUM(people), 0) FROM registrations
  WHERE event_id = ? AND is_member = ? AND source = 'online'
    AND (status = 'accepted' OR (status = 'pending_payment' AND pay_deadline > ?))`;

export async function seatsUsed(db: D1Database, eventId: number, isMember: boolean, nowIso: string) {
  const row = await db
    .prepare(`SELECT (${SEATS_USED_SQL}) AS used`)
    .bind(eventId, isMember ? 1 : 0, nowIso)
    .first<{ used: number }>();
  return row?.used ?? 0;
}

export async function audit(
  db: D1Database,
  actor: string,
  action: string,
  target: string | null,
  detail?: unknown,
  nowIso = new Date().toISOString(),
) {
  await auditStatement(db, actor, action, target, detail, nowIso).run();
}

export function auditStatement(
  db: D1Database,
  actor: string,
  action: string,
  target: string | null,
  detail: unknown,
  nowIso: string,
) {
  return db
    .prepare("INSERT INTO audit_log (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(nowIso, actor, action, target, detail === undefined ? null : JSON.stringify(detail));
}
