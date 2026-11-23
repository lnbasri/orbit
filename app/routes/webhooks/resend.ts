import type { Route } from "./+types/resend";
import { getAppEnv } from "~/lib/env.server";
import { verifyResendWebhook } from "~/lib/email.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
  const env = getAppEnv();
  const body = await request.text();
  if (!(await verifyResendWebhook(env.RESEND_WEBHOOK_SECRET, request.headers, body))) {
    return new Response("Invalid webhook signature.", { status: 401 });
  }

  let event: {
    type?: unknown;
    data?: { email_id?: unknown; to?: unknown };
  };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    return new Response("Invalid webhook payload.", { status: 400 });
  }
  const emailId = event.data?.email_id;
  if (typeof event.type !== "string" || typeof emailId !== "string") {
    return new Response("Invalid webhook payload.", { status: 400 });
  }
  const now = new Date().toISOString();
  if (event.type === "email.delivered") {
    await env.DB.prepare(
      `UPDATE send_queue SET delivered_at = ?, updated_at = ?
       WHERE provider_message_id = ? AND status = 'sent'`,
    ).bind(now, now, emailId).run();
  } else if (event.type === "email.bounced") {
    await env.DB.prepare(
      `UPDATE send_queue
       SET status = 'bounced', bounced_at = ?, failed_at = ?, last_error = 'Resend reported a bounce.',
           updated_at = ?
       WHERE provider_message_id = ? AND status = 'sent'`,
    ).bind(now, now, now, emailId).run();
  } else if (event.type === "email.complained") {
    const recipient = Array.isArray(event.data?.to) && typeof event.data.to[0] === "string"
      ? event.data.to[0].trim().toLowerCase()
      : "";
    if (recipient) {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE send_queue
           SET status = 'unsubscribed', last_error = 'Recipient reported the message as spam.',
               failed_at = ?, updated_at = ?
           WHERE provider_message_id = ? AND status = 'sent'`,
        ).bind(now, now, emailId),
        env.DB.prepare(
          `INSERT OR IGNORE INTO unsubscribes (email, unsubscribe_at, created_at)
           VALUES (?, ?, ?)`,
        ).bind(recipient, now, now),
      ]);
    }
  }
  return new Response(null, { status: 204 });
}
