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

/** FR-ADM-18 / N6: admin records that the member claim was checked manually. */
export async function setMembershipVerified(
  db: D1Database,
  registrationId: string,
  actor: string,
  verified: boolean,
  now = new Date(),
): Promise<ActionResult> {
  const nowIso = now.toISOString();
  const res = await db.batch([
    db
      .prepare(
        `UPDATE registrations SET membership_verified_at = ?, membership_verified_by = ?
         WHERE id = ? AND is_member = 1`,
      )
      .bind(verified ? nowIso : null, verified ? actor : null, registrationId),
    auditStatement(db, actor, verified ? "membership.verify" : "membership.unverify", registrationId, undefined, nowIso),
  ]);
  if ((res[0].meta.changes ?? 0) !== 1) return { ok: false, message: "Bukan pendaftaran anggota." };
  return { ok: true, message: verified ? "Keanggotaan ditandai terverifikasi." : "Tanda verifikasi dihapus." };
}
