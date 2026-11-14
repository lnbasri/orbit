import { addAdmin, removeAdmin } from "./admins.server";
import { updateEventDetails, updateEventLocation, updateEventTimes, updateEventPrice, updateQuotas, updateRegistrationWindow } from "./events.server";
import { emailConfig, type AppEnv } from "./config.server";
import { audit, getEventBySlug } from "./db.server";
import { deliverEmail, type EmailKind } from "./email/send.server";
import { runDeadlineJob } from "./jobs.server";
import { confirmPayment, deleteRegistration, rejectMembership, setMembershipVerified } from "./payments.server";

export type AdminActionResult = { ok: boolean; message: string };

const EMAIL_KINDS: EmailKind[] = ["confirmation", "payment_instructions", "reminder", "expired", "membership_pending"];

/** Shared POST handler for admin pages. `intent` selects the operation. */
export async function handleAdminIntent(env: AppEnv, actor: string, form: FormData): Promise<AdminActionResult> {
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("registrationId") ?? "");
  const cfg = emailConfig(env);

  switch (intent) {
    case "confirm-payment": {
      const res = await confirmPayment(env.DB, id, actor);
      if (!res.ok) return res;
      // Send the QR email synchronously so the admin sees whether it went out.
      const mail = await deliverEmail(env.DB, cfg, id, "confirmation");
      return {
        ok: true,
        message: mail.ok
          ? `${res.message} ${mail.skipped ? "Email QR code sudah dikirim atau sedang diproses." : "Email QR code telah dikirim."}`
          : `${res.message} Namun email QR gagal dikirim (${mail.error}). Sistem akan mencoba lagi otomatis.`,
      };
    }
    case "verify-membership": {
      const res = await setMembershipVerified(env.DB, id, actor, true);
      if (!res.ok || !res.activated) return res;
      // The member is accepted and the ticket codes exist. The QR email is already queued in the outbox; try to send it
      // right away (one registration per click, so one Worker invocation only generates this family's QR codes). When
      // that fails or is skipped, the 5-minute cron sweeps it (in small batches, see runDeadlineJob).
      const mail = await deliverEmail(env.DB, cfg, id, "confirmation");
      return {
        ok: true,
        message: mail.ok
          ? `${res.message}${mail.skipped ? " (email sedang diproses)" : ""}`
          : `${res.message} Namun email QR gagal dikirim (${mail.error}); sistem akan mencoba lagi otomatis.`,
      };
    }
    case "delete-registration":
      return deleteRegistration(env.DB, id, actor);
    case "reject-membership":
      return rejectMembership(env.DB, id, actor);
    case "unverify-membership":
      return setMembershipVerified(env.DB, id, actor, false);
    case "resend-email": {
      const kind = String(form.get("kind") ?? "") as EmailKind;
      if (!EMAIL_KINDS.includes(kind)) return { ok: false, message: "Jenis email tidak dikenal." };
      const mail = await deliverEmail(env.DB, cfg, id, kind, { force: true });
      await audit(env.DB, actor, "email.resend", id, { kind, ok: mail.ok });
      return mail.ok
        ? { ok: true, message: "Email dikirim ulang." }
        : { ok: false, message: `Email gagal dikirim: ${mail.error}` };
    }
    case "add-admin":
      return addAdmin(env.DB, actor, String(form.get("email") ?? ""), String(form.get("name") ?? ""));
    case "remove-admin":
      return removeAdmin(env.DB, actor, String(form.get("email") ?? ""));
    case "save-event-settings": {
      const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
      if (!event) return { ok: false, message: "Acara tidak ditemukan." };
      return updateRegistrationWindow(
        env.DB,
        actor,
        event.id,
        String(form.get("opensAt") ?? ""),
        String(form.get("closesAt") ?? ""),
      );
    }
    case "save-event-times": {
      const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
      if (!event) return { ok: false, message: "Acara tidak ditemukan." };
      return updateEventTimes(env.DB, actor, event.id, String(form.get("startsAt") ?? ""), String(form.get("endsAt") ?? ""));
    }
    case "save-event-details": {
      const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
      if (!event) return { ok: false, message: "Acara tidak ditemukan." };
      return updateEventDetails(env.DB, actor, event.id, String(form.get("speaker") ?? ""), String(form.get("theme") ?? ""));
    }
    case "save-event-location": {
      const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
      if (!event) return { ok: false, message: "Acara tidak ditemukan." };
      return updateEventLocation(
        env.DB,
        actor,
        event.id,
        String(form.get("locationName") ?? ""),
        String(form.get("locationAddress") ?? ""),
        String(form.get("locationMapUrl") ?? ""),
      );
    }
    case "save-event-price": {
      const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
      if (!event) return { ok: false, message: "Acara tidak ditemukan." };
      return updateEventPrice(env.DB, actor, event.id, String(form.get("price") ?? ""));
    }
    case "save-quotas": {
      const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
      if (!event) return { ok: false, message: "Acara tidak ditemukan." };
      return updateQuotas(env.DB, actor, event.id, String(form.get("quotaMember") ?? ""), String(form.get("quotaNonMember") ?? ""));
    }
    case "run-job": {
      const report = await runDeadlineJob(env.DB, cfg);
      await audit(env.DB, actor, "job.run", null, report);
      return {
        ok: true,
        message: `Job selesai: ${report.expired} kedaluwarsa, ${report.reminders} pengingat, ${report.retried} email dicoba ulang${report.deferred ? `, ${report.deferred} email QR menunggu giliran berikutnya` : ""}.`,
      };
    }
    default:
      return { ok: false, message: "Aksi tidak dikenal." };
  }
}
