import { payingCount, seatCount } from "./format";
import {
  SEATS_USED_SQL,
  getEventById,
  seatsUsed,
  type EventRow,
  type RegistrationRow,
} from "./db.server";
import { outboxStatement } from "./email/send.server";
import { newId, newTicketToken } from "./ids";
import { MEDIA_NOTICE_VERSION } from "./rules";
import type { RegistrationInput } from "./validation";

export type RegisterResult =
  | { kind: "pending_membership"; registrationId: string; people: number }
  /** `member` false = a non-member registering while the price is 0 (accepted at once, QR email follows via the outbox). */
  | { kind: "accepted"; registrationId: string; people: number; member: boolean }
  | {
      kind: "pending_payment";
      registrationId: string;
      people: number;
      paymentCode: string;
      amountCents: number;
      payDeadline: string;
    }
  | { kind: "rejected_quota"; registrationId: string; remaining: number; people: number; seats: number }
  | { kind: "duplicate_email" }
  | { kind: "closed"; reason: string };

export interface RegisterOptions {
  now?: Date;
  /** Skip the opening/closing window check (local development). */
  ignoreWindow?: boolean;
}

export function registrationWindowError(event: EventRow, now: Date): string | null {
  const iso = now.toISOString();
  if (event.status !== "open") return "Pendaftaran untuk acara ini tidak dibuka.";
  if (event.registration_opens_at && iso < event.registration_opens_at)
    return "Pendaftaran belum dibuka.";
  if (event.registration_closes_at && iso >= event.registration_closes_at)
    return "Pendaftaran sudah ditutup.";
  if (iso >= event.starts_at) return "Pendaftaran sudah ditutup.";
  return null;
}

export function nonMemberOpeningError(event: EventRow, now: Date): string | null {
  if (event.non_member_opens_at && now.toISOString() < event.non_member_opens_at) {
    return "Pendaftaran non-anggota belum dibuka.";
  }
  return null;
}

function resultFromRow(row: RegistrationRow, remaining = 0): RegisterResult {
  switch (row.status) {
    case "pending_membership":
      return { kind: "pending_membership", registrationId: row.id, people: row.people };
    case "accepted":
      return { kind: "accepted", registrationId: row.id, people: row.people, member: row.is_member === 1 };
    case "pending_payment":
      return {
        kind: "pending_payment",
        registrationId: row.id,
        people: row.people,
        paymentCode: row.payment_code ?? "",
        amountCents: row.amount_cents,
        payDeadline: row.pay_deadline ?? "",
      };
    case "rejected_quota":
      return { kind: "rejected_quota", registrationId: row.id, remaining, people: row.people, seats: row.seats };
    default:
      return { kind: "closed", reason: "Pendaftaran ini sudah kedaluwarsa." };
  }
}

function isUniqueViolation(err: unknown, needle: string) {
  const msg = String((err as Error)?.message ?? err);
  return msg.includes("UNIQUE constraint failed") && msg.includes(needle);
}

/**
 * Online registration (FR-QUO-*). The quota check and all inserts run in one D1 batch, which is a
 * single transaction, so two families can never take the same last seats.
 */
export async function registerOnline(
  db: D1Database,
  event: EventRow,
  input: RegistrationInput,
  opts: RegisterOptions = {},
): Promise<RegisterResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();

  if (!opts.ignoreWindow) {
    const closed = registrationWindowError(event, now);
    if (closed) return { kind: "closed", reason: closed };
    if (input.membership === "Tidak") {
      const nonMemberClosed = nonMemberOpeningError(event, now);
      if (nonMemberClosed) return { kind: "closed", reason: nonMemberClosed };
    }
  }
  if (input.participants.length > event.max_family) {
    return { kind: "closed", reason: `Maksimal ${event.max_family} peserta per pendaftaran.` };
  }

  // Replayed submit (double click, retry): return the original outcome.
  if (input.idempotencyKey) {
    const existing = await db
      .prepare("SELECT * FROM registrations WHERE idempotency_key = ?")
      .bind(input.idempotencyKey)
      .first<RegistrationRow>();
    if (existing) return resultFromRow(existing);
  }

  const isMember = input.membership === "Ya";
  const people = input.participants.length;
  const seats = seatCount(input.participants); // only remaja + dewasa take a quota seat
  const registrationId = newId();
  // Price 0 (free event): a non-member is accepted at once, with ticket codes, and there is no payment step at all.
  // Members still wait for validation. The QR email is only queued here; the cron sweeper renders and sends it.
  const freeNonMember = !isMember && event.price_non_member_cents === 0;
  const needsPayment = !isMember && !freeNonMember;
  const amountCents = needsPayment ? payingCount(input.participants) * event.price_non_member_cents : 0;
  const payDeadline = needsPayment
    ? new Date(now.getTime() + event.pay_window_min * 60_000).toISOString()
    : null;
  const quotaColumn = isMember ? "quota_member" : "quota_non_member";
  const regStatus = isMember ? "pending_membership" : freeNonMember ? "accepted" : "pending_payment";
  const participantStatus = isMember ? "pending_membership" : freeNonMember ? "accepted" : "pending_payment";

  const statements: D1PreparedStatement[] = [];
  if (needsPayment) {
    statements.push(
      db.prepare("UPDATE events SET payment_counter = payment_counter + 1 WHERE id = ?").bind(event.id),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO registrations (
           id, event_id, created_at, registrant_name, is_member, email, whatsapp, people, seats, source,
           status, payment_status, payment_code, amount_cents, pay_deadline,
           consent_at, privacy_version, media_consent_at, media_notice_version, marketing_opt_in, idempotency_key)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, ?,
           ${!needsPayment ? "NULL" : "(SELECT payment_prefix || printf('%06d', payment_counter) FROM events WHERE id = ?)"},
           ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (${SEATS_USED_SQL}) + ? <= (SELECT ${quotaColumn} FROM events WHERE id = ?)`,
      )
      .bind(
        registrationId,
        event.id,
        nowIso,
        input.registrantName,
        isMember ? 1 : 0,
        input.email,
        input.whatsapp,
        people,
        seats,
        regStatus,
        needsPayment ? "pending" : "free",
        ...(needsPayment ? [event.id] : []),
        amountCents,
        payDeadline,
        nowIso,
        event.privacy_version,
        nowIso,
        MEDIA_NOTICE_VERSION,
        input.marketingOptIn ? 1 : 0,
        input.idempotencyKey ?? null,
        event.id,
        isMember ? 1 : 0,
        nowIso,
        seats,
        event.id,
      ),
  );

  input.participants.forEach((p, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO participants (id, registration_id, position, full_name, age_group, gender, status, qr_token)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM registrations WHERE id = ?)`,
        )
        .bind(
          newId(),
          registrationId,
          index + 1,
          p.name,
          p.ageGroup,
          p.gender,
          // Members get their ticket codes only once an admin has validated the membership (activateMember).
          participantStatus,
          freeNonMember ? newTicketToken() : null,
          registrationId,
        ),
    );
  });

  // Outbox: the email is recorded in the SAME transaction as the registration, so it cannot be lost.
  statements.push(
    outboxStatement(db, registrationId, isMember ? "membership_pending" : freeNonMember ? "confirmation" : "payment_instructions", nowIso),
  );

  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch (err) {
    if (isUniqueViolation(err, "registrations.event_id") || isUniqueViolation(err, "uq_reg_event_email")) {
      return { kind: "duplicate_email" };
    }
    if (isUniqueViolation(err, "idempotency_key") && input.idempotencyKey) {
      const existing = await db
        .prepare("SELECT * FROM registrations WHERE idempotency_key = ?")
        .bind(input.idempotencyKey)
        .first<RegistrationRow>();
      if (existing) return resultFromRow(existing);
    }
    throw err;
  }

  const inserted = (results[needsPayment ? 1 : 0].meta.changes ?? 0) === 1;

  if (inserted) {
    if (isMember) return { kind: "pending_membership", registrationId, people };
    if (freeNonMember) return { kind: "accepted", registrationId, people, member: false };
    const row = await db
      .prepare("SELECT payment_code FROM registrations WHERE id = ?")
      .bind(registrationId)
      .first<{ payment_code: string }>();
    return {
      kind: "pending_payment",
      registrationId,
      people,
      paymentCode: row?.payment_code ?? "",
      amountCents,
      payDeadline: payDeadline!,
    };
  }

  // Quota full: record the rejection for the committee (FR-QUO-7). No email is sent.
  const fresh = (await getEventById(db, event.id)) ?? event;
  const used = await seatsUsed(db, event.id, isMember, nowIso);
  const remaining = Math.max(0, (isMember ? fresh.quota_member : fresh.quota_non_member) - used);

  const rejected: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO registrations (
           id, event_id, created_at, registrant_name, is_member, email, whatsapp, people, seats, source,
           status, payment_status, amount_cents, consent_at, privacy_version, media_consent_at, media_notice_version, marketing_opt_in, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', 'rejected_quota', 'not_processed', 0, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        registrationId,
        event.id,
        nowIso,
        input.registrantName,
        isMember ? 1 : 0,
        input.email,
        input.whatsapp,
        people,
        seats,
        nowIso,
        event.privacy_version,
        nowIso,
        MEDIA_NOTICE_VERSION,
        input.marketingOptIn ? 1 : 0,
        input.idempotencyKey ?? null,
      ),
    ...input.participants.map((p, index) =>
      db
        .prepare(
          `INSERT INTO participants (id, registration_id, position, full_name, age_group, gender, status)
           VALUES (?, ?, ?, ?, ?, ?, 'rejected')`,
        )
        .bind(newId(), registrationId, index + 1, p.name, p.ageGroup, p.gender),
    ),
  ];
  await db.batch(rejected);

  return { kind: "rejected_quota", registrationId, remaining, people, seats };
}

export async function quotaSummary(db: D1Database, event: EventRow, now = new Date()) {
  const nowIso = now.toISOString();
  const [member, nonMember] = await Promise.all([
    seatsUsed(db, event.id, true, nowIso),
    seatsUsed(db, event.id, false, nowIso),
  ]);
  return {
    member: { quota: event.quota_member, used: member, remaining: Math.max(0, event.quota_member - member) },
    nonMember: {
      quota: event.quota_non_member,
      used: nonMember,
      remaining: Math.max(0, event.quota_non_member - nonMember),
    },
  };
}
