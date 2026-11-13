import { auditStatement, getParticipants, getRegistration } from "./db.server";
import { newTicketToken } from "./ids";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * FR-PAY-3: admin confirms a bank transfer for a pending non-member registration.
 * Every write is conditional on the registration still being pending and inside its deadline,
 * so a concurrent expiry run and a confirmation can never both win.
 */
export async function confirmPayment(
  db: D1Database,
  registrationId: string,
  actor: string,
  now = new Date(),
): Promise<ActionResult> {
  const nowIso = now.toISOString();
  const reg = await getRegistration(db, registrationId);
  if (!reg) return { ok: false, message: "Pendaftaran tidak ditemukan." };
  if (reg.status !== "pending_payment" || reg.payment_status !== "pending") {
    return { ok: false, message: "Pendaftaran ini tidak sedang menunggu pembayaran." };
  }
  if (!reg.pay_deadline || reg.pay_deadline <= nowIso) {
    return { ok: false, message: "Batas pembayaran sudah lewat. Pendaftaran tidak dapat diaktifkan." };
  }
  const participants = await getParticipants(db, registrationId);
  if (participants.length !== reg.people || participants.some((p) => p.status !== "pending_payment")) {
    return { ok: false, message: "Data peserta tidak sesuai. Periksa data terlebih dahulu." };
  }

  const confirmed = `EXISTS (SELECT 1 FROM registrations WHERE id = ? AND status = 'accepted' AND paid_at = ? AND confirmed_by = ?)`;
  const results = await db.batch([
    db
      .prepare(
        `UPDATE registrations SET status = 'accepted', payment_status = 'paid', paid_at = ?, confirmed_by = ?
         WHERE id = ? AND status = 'pending_payment' AND payment_status = 'pending' AND pay_deadline > ?
           AND edit_rev IS ?`, // a self-service edit since the participants were read makes this a no-op (reload)
      )
      .bind(nowIso, actor, registrationId, nowIso, reg.edit_rev),
    ...participants.map((p) =>
      db
        .prepare(
          `UPDATE participants SET status = 'accepted', qr_token = ?
           WHERE id = ? AND status = 'pending_payment' AND ${confirmed}`,
        )
        .bind(newTicketToken(), p.id, registrationId, nowIso, actor),
    ),
    db
      .prepare(
        `INSERT INTO email_log (registration_id, kind, status, attempts, updated_at)
         SELECT ?, 'confirmation', 'pending', 0, ? WHERE ${confirmed}
         ON CONFLICT (registration_id, kind) DO NOTHING`,
      )
      .bind(registrationId, nowIso, registrationId, nowIso, actor),
    auditStatement(db, actor, "payment.confirm", registrationId, { code: reg.payment_code }, nowIso),
  ]);

  if ((results[0].meta.changes ?? 0) !== 1) {
    return { ok: false, message: "Status pendaftaran berubah. Muat ulang halaman dan coba lagi." };
  }
  return { ok: true, message: "Pembayaran berhasil dikonfirmasi." };
}

/**
 * Re-validating a registration that was rejected for invalid membership: it becomes accepted again, the participants
 * get fresh ticket codes and the confirmation (QR) email is queued again. Blocked while another active registration
 * uses the same email (the unique index would reject it). Does not re-check quota: it is an explicit admin decision.
 */
async function reviveRejectedMember(
  db: D1Database,
  registrationId: string,
  actor: string,
  nowIso: string,
): Promise<ActionResult & { revived?: true }> {
  const reg = await getRegistration(db, registrationId);
  if (!reg || reg.status !== "rejected_membership") {
    return { ok: false, message: "Pendaftaran tidak ditemukan atau statusnya sudah berubah." };
  }
  if (reg.email) {
    const clash = await db
      .prepare(
        `SELECT 1 AS x FROM registrations WHERE event_id = ? AND lower(email) = lower(?) AND id != ?
           AND status IN ('accepted', 'pending_payment')`,
      )
      .bind(reg.event_id, reg.email, registrationId)
      .first();
    if (clash) return { ok: false, message: "Email ini sudah dipakai pendaftaran aktif lain; tidak dapat diaktifkan kembali." };
  }
  const participants = await getParticipants(db, registrationId);
  const active = `EXISTS (SELECT 1 FROM registrations WHERE id = ? AND status = 'accepted' AND membership_verified_at = ? AND membership_verified_by = ?)`;
  try {
    const res = await db.batch([
      db
        .prepare(
          `UPDATE registrations SET status = 'accepted', payment_status = 'free', membership_verified_at = ?,
             membership_verified_by = ?, updated_at = ?
           WHERE id = ? AND is_member = 1 AND status = 'rejected_membership'`,
        )
        .bind(nowIso, actor, nowIso, registrationId),
      ...participants.map((p) =>
        db
          .prepare(`UPDATE participants SET status = 'accepted', qr_token = ? WHERE id = ? AND status = 'rejected' AND ${active}`)
          .bind(newTicketToken(), p.id, registrationId, nowIso, actor),
      ),
      db
        .prepare(
          `INSERT INTO email_log (registration_id, kind, status, attempts, updated_at)
           SELECT ?, 'confirmation', 'pending', 0, ? WHERE ${active}
           ON CONFLICT (registration_id, kind) DO UPDATE SET status = 'pending', attempts = 0, sent_at = NULL,
             last_error = NULL, provider_id = NULL, updated_at = excluded.updated_at`,
        )
        .bind(registrationId, nowIso, registrationId, nowIso, actor),
      db
        .prepare(
          `INSERT INTO audit_log (at, actor, action, target, detail)
           SELECT ?, ?, 'membership.verify', ?, '{"revived":true}' WHERE ${active}`,
        )
        .bind(nowIso, actor, registrationId, registrationId, nowIso, actor),
    ]);
    if ((res[0].meta.changes ?? 0) !== 1) {
      return { ok: false, message: "Status pendaftaran berubah. Muat ulang halaman dan coba lagi." };
    }
  } catch {
    return { ok: false, message: "Gagal mengaktifkan kembali (email sudah dipakai pendaftaran lain?)." };
  }
  return { ok: true, revived: true, message: "Keanggotaan valid; pendaftaran diaktifkan kembali dan QR Code baru dikirim." };
}

/** FR-ADM-18 / N6: admin records that the member claim was checked manually. */
export async function setMembershipVerified(
  db: D1Database,
  registrationId: string,
  actor: string,
  verified: boolean,
  now = new Date(),
): Promise<ActionResult & { revived?: true }> {
  const nowIso = now.toISOString();
  if (verified) {
    const current = await getRegistration(db, registrationId);
    if (current?.status === "rejected_membership") return reviveRejectedMember(db, registrationId, actor, nowIso);
  }
  const res = await db.batch([
    db
      .prepare(
        `UPDATE registrations SET membership_verified_at = ?, membership_verified_by = ?
         WHERE id = ? AND is_member = 1 AND status != 'rejected_membership'`,
      )
      .bind(verified ? nowIso : null, verified ? actor : null, registrationId),
    auditStatement(db, actor, verified ? "membership.verify" : "membership.unverify", registrationId, undefined, nowIso),
  ]);
  if ((res[0].meta.changes ?? 0) !== 1) return { ok: false, message: "Bukan pendaftaran anggota." };
  return { ok: true, message: verified ? "Keanggotaan ditandai terverifikasi." : "Tanda verifikasi dihapus." };
}

/**
 * Admin could not validate the member claim: the registration becomes 'rejected_membership' (no email for now).
 * Participants are rejected and their QR codes removed, the email is released (the unique index only covers active
 * statuses) and the seat is freed. Conditional on the registration still being an unverified, accepted member
 * with nobody checked in, so a concurrent verify / check-in wins cleanly.
 */
export async function rejectMembership(
  db: D1Database,
  registrationId: string,
  actor: string,
  now = new Date(),
): Promise<ActionResult> {
  const nowIso = now.toISOString();
  const rejected = `EXISTS (SELECT 1 FROM registrations WHERE id = ? AND status = 'rejected_membership' AND updated_at = ?)`;
  const res = await db.batch([
    db
      .prepare(
        `UPDATE registrations SET status = 'rejected_membership', payment_status = 'not_processed', updated_at = ?
         WHERE id = ? AND is_member = 1 AND status = 'accepted' AND membership_verified_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.registration_id = registrations.id AND p.checked_in_at IS NOT NULL)`,
      )
      .bind(nowIso, registrationId),
    db
      .prepare(`UPDATE participants SET status = 'rejected', qr_token = NULL WHERE registration_id = ? AND ${rejected}`)
      .bind(registrationId, registrationId, nowIso),
    db
      .prepare(
        `INSERT INTO audit_log (at, actor, action, target, detail)
         SELECT ?, ?, 'membership.reject', ?, NULL WHERE ${rejected}`,
      )
      .bind(nowIso, actor, registrationId, registrationId, nowIso),
  ]);
  if ((res[0].meta.changes ?? 0) !== 1) {
    return { ok: false, message: "Tidak dapat ditolak: bukan anggota yang belum diverifikasi, sudah check-in, atau status sudah berubah." };
  }
  return { ok: true, message: "Pendaftaran ditolak (keanggotaan tidak valid)." };
}

/**
 * Permanently deletes a registration with its participants and email log (admin only). The deletion is written to the
 * audit log first, and every delete is gated on that audit row, so it is all-or-nothing. Refused once anyone checked in.
 */
export async function deleteRegistration(
  db: D1Database,
  registrationId: string,
  actor: string,
  now = new Date(),
): Promise<ActionResult> {
  const nowIso = now.toISOString();
  const reg = await getRegistration(db, registrationId);
  if (!reg) return { ok: false, message: "Pendaftaran tidak ditemukan." };
  const logged = `EXISTS (SELECT 1 FROM audit_log WHERE at = ? AND actor = ? AND action = 'registration.delete' AND target = ?)`;
  const detail = JSON.stringify({
    name: reg.registrant_name,
    status: reg.status,
    people: reg.people,
    member: !!reg.is_member,
    source: reg.source,
  });
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO audit_log (at, actor, action, target, detail)
         SELECT ?, ?, 'registration.delete', ?, ? WHERE EXISTS (SELECT 1 FROM registrations WHERE id = ?)
           AND NOT EXISTS (SELECT 1 FROM participants WHERE registration_id = ? AND checked_in_at IS NOT NULL)`,
      )
      .bind(nowIso, actor, registrationId, detail, registrationId, registrationId),
    db.prepare(`DELETE FROM participants WHERE registration_id = ? AND ${logged}`).bind(registrationId, nowIso, actor, registrationId),
    db.prepare(`DELETE FROM email_log WHERE registration_id = ? AND ${logged}`).bind(registrationId, nowIso, actor, registrationId),
    db.prepare(`DELETE FROM dev_outbox WHERE registration_id = ? AND ${logged}`).bind(registrationId, nowIso, actor, registrationId),
    db.prepare(`DELETE FROM registrations WHERE id = ? AND ${logged}`).bind(registrationId, nowIso, actor, registrationId),
  ]);
  if ((res[0].meta.changes ?? 0) !== 1) {
    return { ok: false, message: "Tidak dapat dihapus: sudah ada peserta yang check-in atau data sudah berubah." };
  }
  return { ok: true, message: "Pendaftaran dihapus." };
}
