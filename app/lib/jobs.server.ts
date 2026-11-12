import { auditStatement } from "./db.server";
import { MAX_EMAIL_ATTEMPTS, deliverEmail, type EmailConfig, type EmailKind } from "./email/send.server";

export interface JobReport {
  expired: number;
  reminders: number;
  retried: number;
}

/**
 * FR-JOB-*: runs every 5 minutes from the Cron Trigger (and on demand from the admin page).
 * 1. Expire unpaid registrations whose deadline has passed and release their seats.
 * 2. Send the payment reminder once, `reminder_after_min` after registration.
 * 3. Sweep the outbox: send emails still 'pending' or 'failed' (max 5 attempts, 60 s lease).
 */
/**
 * Expire unpaid registrations whose deadline has passed and release their seats. Each expiry also records its
 * pending "expired" email in the same transaction. Returns the ids expired by THIS call.
 */
export async function expireDue(db: D1Database, now = new Date()): Promise<string[]> {
  const nowIso = now.toISOString();
  const { results: due } = await db
    .prepare(
      `SELECT id FROM registrations
       WHERE status = 'pending_payment' AND pay_deadline IS NOT NULL AND pay_deadline <= ?`,
    )
    .bind(nowIso)
    .all<{ id: string }>();

  const expired: string[] = [];
  for (const { id } of due) {
    const res = await db.batch([
      db
        .prepare(
          `UPDATE registrations SET status = 'expired', payment_status = 'expired'
           WHERE id = ? AND status = 'pending_payment' AND pay_deadline <= ?`,
        )
        .bind(id, nowIso),
      db
        .prepare(
          `UPDATE participants SET status = 'expired'
           WHERE registration_id = ? AND status = 'pending_payment'
             AND EXISTS (SELECT 1 FROM registrations WHERE id = ? AND status = 'expired')`,
        )
        .bind(id, id),
      db
        .prepare(
          `INSERT INTO email_log (registration_id, kind, status, attempts, updated_at)
           SELECT ?, 'expired', 'pending', 0, ?
           WHERE EXISTS (SELECT 1 FROM registrations WHERE id = ? AND status = 'expired')
           ON CONFLICT (registration_id, kind) DO NOTHING`,
        )
        .bind(id, nowIso, id),
      auditStatement(db, "system", "registration.expire", id, undefined, nowIso),
    ]);
    if ((res[0].meta.changes ?? 0) === 1) expired.push(id);
  }
  return expired;
}

export async function runDeadlineJob(db: D1Database, cfg: EmailConfig, now = new Date()): Promise<JobReport> {
  const nowIso = now.toISOString();
  const report: JobReport = { expired: 0, reminders: 0, retried: 0 };

  for (const id of await expireDue(db, now)) {
    report.expired++;
    await deliverEmail(db, cfg, id, "expired", { now });
  }

  const { results: needReminder } = await db
    .prepare(
      `SELECT r.id FROM registrations r JOIN events e ON e.id = r.event_id
       WHERE r.status = 'pending_payment' AND r.pay_deadline > ?
         AND strftime('%Y-%m-%dT%H:%M:%fZ', r.created_at, '+' || e.reminder_after_min || ' minutes') <= ?
         AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.registration_id = r.id AND l.kind = 'reminder')`,
    )
    .bind(nowIso, nowIso)
    .all<{ id: string }>();

  for (const { id } of needReminder) {
    const r = await deliverEmail(db, cfg, id, "reminder", { now });
    if (r.ok && !r.skipped) report.reminders++;
  }

  const { results: failed } = await db
    .prepare(
      `SELECT registration_id, kind FROM email_log
       WHERE status IN ('failed', 'pending') AND attempts < ? AND updated_at <= ?`,
    )
    .bind(MAX_EMAIL_ATTEMPTS, new Date(now.getTime() - 60_000).toISOString())
    .all<{ registration_id: string; kind: EmailKind }>();

  for (const row of failed) {
    // A reminder for a registration that is no longer pending is pointless.
    if (row.kind === "reminder" || row.kind === "payment_instructions") {
      const still = await db
        .prepare("SELECT 1 AS ok FROM registrations WHERE id = ? AND status = 'pending_payment'")
        .bind(row.registration_id)
        .first();
      if (!still) continue;
    }
    const r = await deliverEmail(db, cfg, row.registration_id, row.kind, { now });
    if (r.ok && !r.skipped) report.retried++;
  }

  return report;
}
