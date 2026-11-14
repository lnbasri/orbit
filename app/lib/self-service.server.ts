import { payingCount, seatCount } from "./format";
import { SEATS_USED_SQL, getParticipants, seatsUsed, type EventRow, type ParticipantRow, type RegistrationRow } from "./db.server";
import type { EmailKind } from "./email/send.server";
import { newId, newTicketToken } from "./ids";
import type { SelfEditInput } from "./validation";

/**
 * "Pendaftaran saya": a registrant (signed in per event with an email code) views their ACTIVE registration and,
 * while allowed, edits it themselves (decision 12 Nov 2026):
 *  - members (free): editable until registration closes / the event starts, both while the membership still has to be
 *    validated by the committee ('pending_membership') and after validation (accepted, QR codes issued);
 *  - non-members: editable while the payment is pending and the deadline has not passed; once the committee confirms
 *    the payment it is view-only and changes go by email to the committee (event@ppmedenhaag.nl);
 *  - manual registrations are view-only.
 * Editable: registrant name, WhatsApp, each participant's name / gender / age group, adding or removing participants.
 * Email and membership are never self-editable (email is the registration key; membership decides quota and price).
 */

export type LockReason = "paid" | "manual" | "deadline" | "closed";
export type SelfEditState = { editable: true; until: string | null } | { editable: false; reason: LockReason };

/**
 * Self-service freeze (decision 14 Nov 2026): once registration closes nothing can be changed by the registrant any more
 * (edit, add, remove, cancel). Backstop: the freeze is also on from 1 hour before the event starts, whichever is first.
 * Admin actions are not affected.
 */
export const EVENT_DAY_LOCK_MS = 60 * 60_000;

export function editWindowClosed(event: EventRow, now: Date): boolean {
  const iso = now.toISOString();
  if (event.status !== "open") return true;
  if (event.registration_closes_at && iso >= event.registration_closes_at) return true;
  return now.getTime() >= Date.parse(event.starts_at) - EVENT_DAY_LOCK_MS;
}

export function selfEditState(
  reg: RegistrationRow,
  event: EventRow,
  now: Date,
  opts: { ignoreWindow?: boolean } = {},
): SelfEditState {
  const iso = now.toISOString();
  if (reg.source !== "online") return { editable: false, reason: "manual" };
  if (reg.status === "accepted" && reg.payment_status === "paid") return { editable: false, reason: "paid" };
  const member = (reg.status === "accepted" || reg.status === "pending_membership") && reg.is_member === 1 && reg.payment_status === "free";
  const pending = reg.status === "pending_payment" && reg.payment_status === "pending";
  if (!member && !pending) return { editable: false, reason: "closed" };
  if (pending && (!reg.pay_deadline || reg.pay_deadline <= iso)) return { editable: false, reason: "deadline" };
  if (!opts.ignoreWindow && editWindowClosed(event, now)) return { editable: false, reason: "closed" };

  const limits = [event.registration_closes_at, new Date(Date.parse(event.starts_at) - EVENT_DAY_LOCK_MS).toISOString(), pending ? reg.pay_deadline : null].filter(
    (v): v is string => !!v,
  );
  return { editable: true, until: limits.sort()[0] ?? null };
}

/** The one active registration (accepted / pending_payment / pending_membership) of this email for the event, if any. */
export async function getActiveRegistrationByEmail(db: D1Database, eventId: number, email: string) {
  return db
    .prepare(
      `SELECT * FROM registrations
       WHERE event_id = ? AND lower(email) = lower(?) AND status IN ('accepted', 'pending_payment', 'pending_membership')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(eventId, email)
    .first<RegistrationRow>();
}

/** Same rule as selfEditState, as SQL on the registrations row (binds: now). */
const EDITABLE_SQL = `source = 'online' AND (
    (status IN ('accepted', 'pending_membership') AND is_member = 1 AND payment_status = 'free')
    OR (status = 'pending_payment' AND payment_status = 'pending' AND pay_deadline > ?))`;

/** Event still open for edits (binds: now, now + 1 hour: the event-day lock). */
const WINDOW_SQL = `EXISTS (SELECT 1 FROM events e WHERE e.id = registrations.event_id AND e.status = 'open'
    AND (e.registration_closes_at IS NULL OR e.registration_closes_at > ?) AND e.starts_at > ?)`;

export type SelfEditResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; registrationId: string; email: EmailKind | null; people: number; amountCents: number }
  | { ok: false; reason: "not_found" | "locked" | "stale" | "quota" | "add_disabled"; message: string };

export const ADD_DISABLED =
  "Penambahan peserta baru sementara tidak dapat dilakukan sendiri. Hubungi panitia untuk menambah peserta; Anda tetap dapat mengubah atau menghapus peserta yang ada.";

const STALE = "Data pendaftaran sudah berubah sejak halaman ini dibuka. Halaman telah dimuat ulang; periksa lalu simpan kembali.";
const LOCKED: Record<LockReason, string> = {
  paid: "Pembayaran sudah dikonfirmasi, sehingga pendaftaran tidak dapat diubah sendiri lagi.",
  manual: "Pendaftaran ini dicatat oleh panitia dan tidak dapat diubah sendiri.",
  deadline: "Batas pembayaran sudah lewat, sehingga pendaftaran tidak dapat diubah lagi.",
  closed: "Pendaftaran sudah ditutup, sehingga data tidak dapat diubah sendiri lagi.",
};
export const lockMessage = (reason: LockReason) => LOCKED[reason];

function sameParticipant(p: ParticipantRow, q: SelfEditInput["participants"][number]) {
  return p.full_name === q.name && p.gender === q.gender && p.age_group === q.ageGroup;
}

/**
 * Apply a self-service edit. Everything happens in ONE db.batch, conditional on the revision the form was loaded with,
 * on the registration still being editable and (when people are added) on the quota, so a concurrent admin payment
 * confirmation, expiry, second tab or last-seat race cannot slip in between. The email that reflects the new state
 * (validated members: confirmation with QR codes; members waiting for validation: the membership notice; pending payment:
 * payment instructions) is re-queued in the same batch (outbox rule). Quota counts seats (remaja + dewasa only).
 */
export async function updateOwnRegistration(
  db: D1Database,
  event: EventRow,
  email: string,
  rev: string,
  input: SelfEditInput,
  opts: { now?: Date; ignoreWindow?: boolean; actor?: string } = {},
): Promise<SelfEditResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const lockIso = new Date(now.getTime() + EVENT_DAY_LOCK_MS).toISOString();
  const reg = await getActiveRegistrationByEmail(db, event.id, email);
  if (!reg) return { ok: false, reason: "not_found", message: "Tidak ada pendaftaran aktif untuk email ini." };
  const state = selfEditState(reg, event, now, opts);
  if (!state.editable) return { ok: false, reason: "locked", message: LOCKED[state.reason] };
  if ((reg.edit_rev ?? "") !== rev) return { ok: false, reason: "stale", message: STALE };

  const current = await getParticipants(db, reg.id);
  const currentById = new Map(current.map((p) => [p.id, p]));
  const keptIds = input.participants.map((p) => p.id).filter((id): id is string => !!id);
  if (new Set(keptIds).size !== keptIds.length || keptIds.some((id) => !currentById.has(id))) {
    return { ok: false, reason: "stale", message: STALE };
  }
  const removed = current.filter((p) => !keptIds.includes(p.id));
  // Quota control: adding NEW participants is an admin switch (events.self_add_allowed, default off).
  const added = input.participants.length - keptIds.length;
  if (added > 0 && !event.self_add_allowed) return { ok: false, reason: "add_disabled", message: ADD_DISABLED };
  const people = input.participants.length;
  const amountCents = reg.is_member ? 0 : payingCount(input.participants) * event.price_non_member_cents;
  const seats = seatCount(input.participants);

  const participantsChanged =
    removed.length > 0 ||
    people !== current.length ||
    input.participants.some((q, i) => {
      const p = q.id ? currentById.get(q.id)! : null;
      return !p || p.position !== i + 1 || !sameParticipant(p, q);
    });
  const nameChanged = reg.registrant_name !== input.registrantName;
  const whatsappChanged = reg.whatsapp !== input.whatsapp;
  if (!participantsChanged && !nameChanged && !whatsappChanged) return { ok: true, changed: false };

  const newRev = crypto.randomUUID();
  const guard = "EXISTS (SELECT 1 FROM registrations WHERE id = ? AND edit_rev = ?)";
  const isMember = reg.is_member === 1;
  const accepted = reg.status === "accepted";
  const awaitingMembership = reg.status === "pending_membership";
  // WhatsApp is not in any email; every other change re-sends the email that shows the current registration.
  const emailKind: EmailKind | null =
    participantsChanged || nameChanged
      ? accepted
        ? "confirmation"
        : awaitingMembership
          ? "membership_pending"
          : "payment_instructions"
      : null;

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE registrations SET registrant_name = ?, whatsapp = ?, people = ?, seats = ?, amount_cents = ?, edit_rev = ?, updated_at = ?
         WHERE id = ? AND lower(email) = lower(?) AND edit_rev IS ? AND status = ? AND ${EDITABLE_SQL}
           ${opts.ignoreWindow ? "" : `AND ${WINDOW_SQL}`}
           AND (? <= seats
             OR (${SEATS_USED_SQL}) - seats + ? <= (SELECT ${isMember ? "quota_member" : "quota_non_member"} FROM events WHERE id = ?))
           AND (? = 0 OR (SELECT self_add_allowed FROM events WHERE id = ?) = 1)`,
      )
      .bind(
        input.registrantName,
        input.whatsapp,
        people,
        seats,
        amountCents,
        newRev,
        nowIso,
        reg.id,
        email,
        reg.edit_rev,
        reg.status, // the edit was prepared for this status (an admin validation in between would change it)
        nowIso,
        ...(opts.ignoreWindow ? [] : [nowIso, lockIso]),
        seats,
        event.id,
        isMember ? 1 : 0,
        nowIso,
        seats,
        event.id,
        added,
        event.id,
      ),
  ];

  if (removed.length) {
    // Remember the codes of removed people (scanners then see "ticket cancelled"); same batch, gated on the edit having applied.
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO revoked_tickets (code, event_id, reason, revoked_at)
           SELECT p.qr_token, ?, 'self_removed', ? FROM participants p
           WHERE p.registration_id = ? AND p.id IN (${removed.map(() => "?").join(", ")}) AND p.qr_token IS NOT NULL AND ${guard}`,
        )
        .bind(event.id, nowIso, reg.id, ...removed.map((p) => p.id), reg.id, newRev),
    );
    statements.push(
      db
        .prepare(
          `DELETE FROM participants WHERE registration_id = ? AND id IN (${removed.map(() => "?").join(", ")}) AND ${guard}`,
        )
        .bind(reg.id, ...removed.map((p) => p.id), reg.id, newRev),
    );
  }

  input.participants.forEach((q, i) => {
    if (q.id) {
      statements.push(
        db
          .prepare(
            `UPDATE participants SET position = ?, full_name = ?, age_group = ?, gender = ?
             WHERE id = ? AND registration_id = ? AND ${guard}`,
          )
          .bind(i + 1, q.name, q.ageGroup, q.gender, q.id, reg.id, reg.id, newRev),
      );
    } else {
      statements.push(
        db
          .prepare(
            `INSERT INTO participants (id, registration_id, position, full_name, age_group, gender, status, qr_token)
             SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
          )
          .bind(
            newId(),
            reg.id,
            i + 1,
            q.name,
            q.ageGroup,
            q.gender,
            accepted ? "accepted" : awaitingMembership ? "pending_membership" : "pending_payment",
            accepted ? newTicketToken() : null,
            reg.id,
            newRev,
          ),
      );
    }
  });

  if (emailKind) {
    statements.push(
      db
        .prepare(
          `INSERT INTO email_log (registration_id, kind, status, attempts, updated_at)
           SELECT ?, ?, 'pending', 0, ? WHERE ${guard}
           ON CONFLICT (registration_id, kind) DO UPDATE SET
             status = 'pending', attempts = 0, last_error = NULL, updated_at = excluded.updated_at`,
        )
        .bind(reg.id, emailKind, nowIso, reg.id, newRev),
    );
  }

  const detail = {
    people: { from: current.length, to: people },
    ...(isMember ? {} : { amountCents: { from: reg.amount_cents, to: amountCents } }),
    fields: [nameChanged && "registrant_name", whatsappChanged && "whatsapp", participantsChanged && "participants"].filter(
      Boolean,
    ),
  };
  statements.push(
    db
      .prepare(`INSERT INTO audit_log (at, actor, action, target, detail) SELECT ?, ?, ?, ?, ? WHERE ${guard}`)
      .bind(nowIso, opts.actor ?? email, "registration.self_edit", reg.id, JSON.stringify(detail), reg.id, newRev),
  );

  const results = await db.batch(statements);
  if ((results[0].meta.changes ?? 0) === 1) {
    return { ok: true, changed: true, registrationId: reg.id, email: emailKind, people, amountCents };
  }

  // Explain why the conditional update did not apply.
  const fresh = await getActiveRegistrationByEmail(db, event.id, email);
  if (!fresh) return { ok: false, reason: "not_found", message: "Tidak ada pendaftaran aktif untuk email ini." };
  const freshState = selfEditState(fresh, event, now, opts);
  if (!freshState.editable) return { ok: false, reason: "locked", message: LOCKED[freshState.reason] };
  if (fresh.edit_rev !== reg.edit_rev) return { ok: false, reason: "stale", message: STALE };
  if (added > 0) {
    const ev = await db.prepare("SELECT self_add_allowed FROM events WHERE id = ?").bind(event.id).first<{ self_add_allowed: number }>();
    if (!ev?.self_add_allowed) return { ok: false, reason: "add_disabled", message: ADD_DISABLED };
  }
  if (seats > fresh.seats) {
    const used = await seatsUsed(db, event.id, isMember, nowIso);
    const quota = isMember ? event.quota_member : event.quota_non_member;
    const free = Math.max(0, quota - used);
    return {
      ok: false,
      reason: "quota",
      message: `Mohon maaf, kuota tidak mencukupi untuk menambah peserta remaja/dewasa. Sisa kuota: ${free} orang.`,
    };
  }
  return { ok: false, reason: "stale", message: STALE };
}

export type CancelResult = { ok: true; message: string } | { ok: false; reason: "not_found" | "locked" | "stale"; message: string };

const CANCEL_STALE = "Data pendaftaran sudah berubah sejak halaman ini dibuka. Halaman telah dimuat ulang; periksa lalu coba lagi.";

/**
 * Self-service cancellation: the registrant deletes their OWN registration (all participants, ticket codes, queued emails,
 * their login sessions and codes), which frees every seat in the quota. Allowed for the same registrations that may be
 * edited (online member, or non-member whose payment is still pending before the deadline) and only while the self-service
 * window is open: NOT after registration closed or within 1 hour of the event start (freeze, 14 Nov 2026), nor once anyone
 * checked in or the payment was confirmed (paid / manual: via the committee). The ticket codes are recorded in
 * `revoked_tickets` in the same batch.
 *
 * Everything is ONE db.batch. The audit row is written first and only when the registration is still the one the page showed
 * (edit_rev) and still eligible; every DELETE is gated on that audit row, so it is all-or-nothing and can only touch rows
 * of this one registration. The audit row holds no name or email (the registrant asked for their data to be deleted).
 */
export async function cancelOwnRegistration(
  db: D1Database,
  event: EventRow,
  email: string,
  rev: string,
  opts: { now?: Date; ignoreWindow?: boolean } = {},
): Promise<CancelResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const lockIso = new Date(now.getTime() + EVENT_DAY_LOCK_MS).toISOString();
  const reg = await getActiveRegistrationByEmail(db, event.id, email);
  if (!reg) return { ok: false, reason: "not_found", message: "Tidak ada pendaftaran aktif untuk email ini." };
  const state = selfEditState(reg, event, now, { ignoreWindow: opts.ignoreWindow });
  if (!state.editable) return { ok: false, reason: "locked", message: LOCKED[state.reason] };
  if ((reg.edit_rev ?? "") !== rev) return { ok: false, reason: "stale", message: CANCEL_STALE };

  const actor = "self-service";
  const logged = `EXISTS (SELECT 1 FROM audit_log WHERE at = ? AND actor = ? AND action = 'registration.self_cancel' AND target = ?)`;
  const bindLogged = [nowIso, actor, reg.id];
  const detail = JSON.stringify({ status: reg.status, people: reg.people, seats: reg.seats, member: reg.is_member === 1 });

  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO audit_log (at, actor, action, target, detail)
         SELECT ?, ?, 'registration.self_cancel', ?, ?
         WHERE EXISTS (SELECT 1 FROM registrations WHERE id = ? AND edit_rev IS ? AND status = ? AND ${EDITABLE_SQL})
           AND (? = 1 OR EXISTS (SELECT 1 FROM events e WHERE e.id = ? AND e.status = 'open'
                                 AND (e.registration_closes_at IS NULL OR e.registration_closes_at > ?) AND e.starts_at > ?))
           AND NOT EXISTS (SELECT 1 FROM participants WHERE registration_id = ? AND checked_in_at IS NOT NULL)`,
      )
      .bind(nowIso, actor, reg.id, detail, reg.id, reg.edit_rev, reg.status, nowIso, opts.ignoreWindow ? 1 : 0, event.id, nowIso, lockIso, reg.id),
    db
      .prepare(
        `INSERT OR IGNORE INTO revoked_tickets (code, event_id, reason, revoked_at)
         SELECT p.qr_token, ?, 'self_cancelled', ? FROM participants p WHERE p.registration_id = ? AND p.qr_token IS NOT NULL AND ${logged}`,
      )
      .bind(event.id, nowIso, reg.id, ...bindLogged),
    db.prepare(`DELETE FROM participants WHERE registration_id = ? AND ${logged}`).bind(reg.id, ...bindLogged),
    db.prepare(`DELETE FROM email_log WHERE registration_id = ? AND ${logged}`).bind(reg.id, ...bindLogged),
    db.prepare(`DELETE FROM dev_outbox WHERE registration_id = ? AND ${logged}`).bind(reg.id, ...bindLogged),
    db
      .prepare(`DELETE FROM registrant_sessions WHERE event_id = ? AND email = lower(?) AND ${logged}`)
      .bind(event.id, email, ...bindLogged),
    db
      .prepare(`DELETE FROM registrant_login_codes WHERE event_id = ? AND email = lower(?) AND ${logged}`)
      .bind(event.id, email, ...bindLogged),
    db.prepare(`DELETE FROM registrations WHERE id = ? AND ${logged}`).bind(reg.id, ...bindLogged),
  ]);
  if ((res[0].meta.changes ?? 0) === 1) {
    return { ok: true, message: "Pendaftaran Anda telah dibatalkan dan datanya dihapus. Kursi sudah dikembalikan ke kuota." };
  }
  const fresh = await getActiveRegistrationByEmail(db, event.id, email);
  if (!fresh) return { ok: false, reason: "not_found", message: "Tidak ada pendaftaran aktif untuk email ini." };
  const freshState = selfEditState(fresh, event, now, { ignoreWindow: opts.ignoreWindow });
  if (!freshState.editable) return { ok: false, reason: "locked", message: LOCKED[freshState.reason] };
  return { ok: false, reason: "stale", message: CANCEL_STALE };
}
