import { normalizeEmail } from "./admins.server";
import { sha256Hex } from "./auth.server";
import type { OrbitEmailConfig } from "./config.server";
import {
  approvalNotificationStatement,
  approvalRequestStatement,
  validateApprover,
} from "./approvals.server";
import { MAX_COMMUNICATION_BATCH_RECIPIENTS } from "./communication-constants";
import { auditStatement } from "./db.server";

export interface EmailTemplateRow {
  id: number;
  name: string;
  subject: string;
  html: string;
  text: string | null;
  kind: string;
  is_system: number;
  is_active: number;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  unsubscribeUrl: string;
}

export type QueueCommunicationBatchResult =
  | { ok: true; communicationId: number; recipientCount: number; message: string }
  | { ok: false; communicationId: 0; recipientCount: 0; message: string };

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTemplate(template: Pick<EmailTemplateRow, "subject" | "html" | "text">, fields: Record<string, string>) {
  const replace = (value: string, html = false) =>
    value.replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (match, rawKey, escapedKey) => {
      const key = rawKey ?? escapedKey;
      if (fields[key] === undefined) return match;
      return html && !rawKey ? escapeHtml(fields[key]) : fields[key];
    });
  return {
    subject: replace(template.subject),
    html: replace(template.html, true),
    text: replace(template.text ?? ""),
  };
}

type RenderedEmailContent = ReturnType<typeof renderTemplate>;
interface QueuedRecipientData {
  [key: string]: string | RenderedEmailContent;
  unsubscribe_url: string;
  rendered: RenderedEmailContent;
}

export async function listEmailTemplates(db: D1Database, activeOnly = false) {
  const { results } = await db
    .prepare(
      `SELECT id, name, subject, html, text, kind, is_system, is_active FROM email_templates
       ${activeOnly ? "WHERE is_active = 1" : ""}
       ORDER BY name`,
    )
    .all<EmailTemplateRow>();
  return results;
}

export async function saveEmailTemplate(
  db: D1Database,
  actorRaw: string,
  input: { id?: number; name: string; subject: string; html: string; text: string; kind: string; active: boolean },
  now = new Date(),
) {
  const name = input.name.trim().toLowerCase();
  const subject = input.subject.trim();
  const html = input.html.trim();
  const text = input.text.trim();
  const kind = input.kind.trim() || "general";
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(name)) {
    return { ok: false as const, message: "Use a template key with 2-40 lowercase letters, numbers, hyphens, or underscores." };
  }
  if (!subject || subject.length > 200 || !html || html.length > 30000 || text.length > 30000 || kind.length > 40) {
    return { ok: false as const, message: "Enter a subject and HTML body within the listed limits." };
  }
  const timestamp = now.toISOString();
  try {
    if (input.id) {
      const result = await db.prepare(
        `UPDATE email_templates
         SET name = ?, subject = ?, html = ?, text = ?, kind = ?, is_active = ?, updated_by = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(
        name, subject, html, text, kind, input.active ? 1 : 0, normalizeEmail(actorRaw), timestamp, input.id,
      ).run();
      if ((result.meta.changes ?? 0) !== 1) return { ok: false as const, message: "Email template not found." };
    } else {
      await db.prepare(
        `INSERT INTO email_templates
           (name, subject, html, text, kind, is_system, is_active, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      ).bind(
        name, subject, html, text, kind, input.active ? 1 : 0, normalizeEmail(actorRaw), timestamp, timestamp,
      ).run();
    }
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed: email_templates.name")) {
      return { ok: false as const, message: "An email template with that key already exists." };
    }
    throw error;
  }
  await auditStatement(db, actorRaw, "communication.template.save", name, { kind, active: input.active }, timestamp).run();
  return { ok: true as const, message: "Email template saved." };
}

export async function queueCommunication(
  db: D1Database,
  input: {
    templateName: string;
    recipientEmail: string;
    fields: Record<string, unknown>;
    sentBy: string;
    assignedTo: string;
    purpose: string;
    publicUrl?: string;
  },
  now = new Date(),
) {
  const email = normalizeEmail(input.recipientEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { ok: false as const, id: 0, message: "Enter a valid recipient email address." };
  }
  const member = await db.prepare(
    `SELECT COUNT(*) AS count, MIN(m.full_name) AS full_name,
            MIN(m.preferred_name) AS preferred_name, MIN(m.first_name) AS first_name,
            MIN(m.communication_consent) AS communication_consent,
            MIN((SELECT h.name FROM member_households mh
                 JOIN households h ON h.id = mh.household_id
                 WHERE mh.member_id = m.id AND mh.valid_until IS NULL)) AS household_name
     FROM members m
     WHERE m.email = ? COLLATE NOCASE AND m.archived_at IS NULL AND m.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM members other
         WHERE other.email = ? COLLATE NOCASE AND other.archived_at IS NULL
           AND (other.communication_consent <> 1 OR other.status = 'deceased')
       )`,
  ).bind(email, email).first<{
    count: number;
    full_name: string | null;
    preferred_name: string | null;
    first_name: string | null;
    communication_consent: number | null;
    household_name: string | null;
  }>();
  if (!member?.count || member.communication_consent !== 1 || !member.full_name) {
    return { ok: false as const, id: 0, message: "Recipient is not an eligible member with communication consent." };
  }
  const unsubscribed = await db
    .prepare("SELECT 1 FROM unsubscribes WHERE email = ? COLLATE NOCASE")
    .bind(email)
    .first();
  if (unsubscribed) return { ok: false as const, id: 0, message: "Recipient has unsubscribed." };

  const template = await db.prepare(
    "SELECT id, name, subject, html, text, kind, is_system, is_active FROM email_templates WHERE name = ? AND is_active = 1",
  ).bind(input.templateName).first<EmailTemplateRow>();
  if (!template) return { ok: false as const, id: 0, message: "Select an active email template." };

  const approvalError = await validateApprover(db, input.sentBy, input.assignedTo);
  if (approvalError) return { ok: false as const, id: 0, message: approvalError };
  const mergeFields = Object.fromEntries(
    Object.entries(input.fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  if (
    Object.entries(mergeFields).some(([key, value]) => !/^[a-zA-Z][\w]{0,39}$/.test(key) || value.length > 10_000) ||
    Object.values(mergeFields).reduce((total, value) => total + value.length, 0) > 30_000
  ) {
    return { ok: false as const, id: 0, message: "Message fields exceed the allowed size." };
  }
  const recipientData = {
    ...mergeFields,
    first_name: member.first_name ?? "",
    preferred_name: member.preferred_name ?? member.full_name,
    full_name: member.full_name,
    household_name: member.household_name ?? "",
    email,
    unsubscribe_url: `${input.publicUrl ?? "https://orbit.example.com"}/unsubscribe?email=${encodeURIComponent(email)}`,
  };
  const rendered = renderTemplate(template, recipientData);
  if (rendered.subject.length > 200 || rendered.html.length > 60_000 || rendered.text.length > 60_000) {
    return { ok: false as const, id: 0, message: "Rendered message exceeds the allowed size." };
  }
  const missingFields = new Set(
    `${rendered.subject}\n${rendered.html}\n${rendered.text}`.match(/\{\{\{?(\w+)\}\}\}?/g) ?? [],
  );
  if (missingFields.size) {
    return {
      ok: false as const,
      id: 0,
      message: `The selected template has unresolved fields: ${[...missingFields].join(", ")}.`,
    };
  }
  const timestamp = now.toISOString();
  const approvalId = crypto.randomUUID();
  const queueKey = crypto.randomUUID();
  const unsubscribeToken = crypto.randomUUID();
  const unsubscribeHash = await sha256Hex(unsubscribeToken);
  const unsubscribeUrl = `${input.publicUrl ?? "https://orbit.example.com"}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  recipientData.unsubscribe_url = unsubscribeUrl;
  const finalRendered = renderTemplate(template, recipientData);
  const result = await db.batch([
    approvalRequestStatement(db, {
      id: approvalId,
      resourceType: "communication",
      resourceId: queueKey,
      requestedBy: input.sentBy,
      assignedTo: input.assignedTo,
      now: timestamp,
    }),
    db.prepare(
      `INSERT INTO send_queue
         (template_id, communication_id, recipient_email, recipient_name, status, attempts,
          max_attempts, created_at, recipient_data_json, purpose, scheduled_at, updated_at,
          approval_request_id, queue_key)
       VALUES (?, NULL, ?, ?, 'pending', 0, 3, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      template.id,
      email,
      member.full_name,
      timestamp,
      JSON.stringify({ ...recipientData, rendered: finalRendered }),
      input.purpose.trim().slice(0, 80) || null,
      timestamp,
      timestamp,
      approvalId,
      queueKey,
    ),
    db.prepare(
      `INSERT INTO unsubscribe_tokens (token_hash, email, queue_key, created_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(unsubscribeHash, email, queueKey, timestamp),
    approvalNotificationStatement(
      db,
      approvalId,
      input.assignedTo,
      `Communication awaiting approval: ${finalRendered.subject}`,
      "/admin/approvals",
      timestamp,
    ),
    auditStatement(db, input.sentBy, "communication.email.queued", queueKey, {
      recipient: email,
      template: template.name,
      purpose: input.purpose.trim() || null,
      approver: normalizeEmail(input.assignedTo),
    }, timestamp),
  ]);
  const queueId = Number(result[1]?.meta.last_row_id);
  return {
    ok: true as const,
    id: queueId,
    message: "Message queued and submitted for approval. Delivery remains disabled until explicitly enabled.",
  };
}

export async function queueCommunicationBatch(
  db: D1Database,
  input: {
    templateName: string;
    recipientIds: string[];
    audienceName?: string;
    fields: Record<string, unknown>;
    sentBy: string;
    assignedTo: string;
    purpose: string;
    publicUrl?: string;
  },
  now = new Date(),
): Promise<QueueCommunicationBatchResult> {
  const recipientIds = [...new Set(input.recipientIds)];
  if (!recipientIds.length) {
    return { ok: false, communicationId: 0, recipientCount: 0, message: "No eligible recipients match these filters." };
  }
  if (recipientIds.length > MAX_COMMUNICATION_BATCH_RECIPIENTS) {
    return {
      ok: false,
      communicationId: 0,
      recipientCount: 0,
      message: `Bulk messages are limited to ${MAX_COMMUNICATION_BATCH_RECIPIENTS} recipients per approval. Narrow the audience filters and try again.`,
    };
  }

  const template = await db.prepare(
    "SELECT id, name, subject, html, text, kind, is_system, is_active FROM email_templates WHERE name = ? AND is_active = 1",
  ).bind(input.templateName).first<EmailTemplateRow>();
  if (!template) {
    return { ok: false, communicationId: 0, recipientCount: 0, message: "Select an active email template." };
  }

  const approvalError = await validateApprover(db, input.sentBy, input.assignedTo);
  if (approvalError) {
    return { ok: false, communicationId: 0, recipientCount: 0, message: approvalError };
  }

  const mergeFields = Object.fromEntries(
    Object.entries(input.fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  if (
    Object.entries(mergeFields).some(([key, value]) => !/^[a-zA-Z][\w]{0,39}$/.test(key) || value.length > 10_000) ||
    Object.values(mergeFields).reduce((total, value) => total + value.length, 0) > 30_000
  ) {
    return { ok: false, communicationId: 0, recipientCount: 0, message: "Message fields exceed the allowed size." };
  }

  const preparedRecipients: {
    email: string;
    name: string;
    data: QueuedRecipientData;
    token: string;
    tokenHash: string;
  }[] = [];
  const seenEmails = new Set<string>();
  let totalPayloadBytes = 0;
  for (const recipientId of recipientIds) {
    const member = await db.prepare(
      `SELECT m.id, m.full_name, m.preferred_name, m.first_name, m.email,
              (SELECT h.name FROM member_households mh
               JOIN households h ON h.id = mh.household_id
               WHERE mh.member_id = m.id AND mh.valid_until IS NULL
               ORDER BY mh.valid_from DESC LIMIT 1) AS household_name
       FROM members m
       WHERE m.id = ? AND m.archived_at IS NULL AND m.status = 'active'
         AND m.communication_consent = 1 AND m.email IS NOT NULL AND m.email <> ''
         AND NOT EXISTS (
           SELECT 1 FROM members other
           WHERE other.email = m.email COLLATE NOCASE AND other.archived_at IS NULL
             AND (other.communication_consent <> 1 OR other.status = 'deceased')
         )
         AND NOT EXISTS (
           SELECT 1 FROM unsubscribes u WHERE u.email = m.email COLLATE NOCASE
         )`,
    ).bind(recipientId).first<{
      id: string;
      full_name: string;
      preferred_name: string | null;
      first_name: string | null;
      email: string;
      household_name: string | null;
    }>();
    if (!member) {
      return {
        ok: false,
        communicationId: 0,
        recipientCount: 0,
        message: "A selected member is no longer eligible. Refresh the audience and try again.",
      };
    }

    const email = normalizeEmail(member.email);
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);
    const token = crypto.randomUUID();
    const recipientData = {
      ...mergeFields,
      first_name: member.first_name ?? "",
      preferred_name: member.preferred_name ?? member.full_name,
      full_name: member.full_name,
      household_name: member.household_name ?? "",
      email,
      unsubscribe_url: `${input.publicUrl ?? "https://orbit.example.com"}/unsubscribe?token=${encodeURIComponent(token)}`,
    };
    const rendered = renderTemplate(template, recipientData);
    if (rendered.subject.length > 200 || rendered.html.length > 60_000 || rendered.text.length > 60_000) {
      return { ok: false, communicationId: 0, recipientCount: 0, message: "Rendered message exceeds the allowed size." };
    }
    const missingFields = new Set(
      `${rendered.subject}\n${rendered.html}\n${rendered.text}`.match(/\{\{\{?(\w+)\}\}\}?/g) ?? [],
    );
    if (missingFields.size) {
      return {
        ok: false,
        communicationId: 0,
        recipientCount: 0,
        message: `The selected template has unresolved fields: ${[...missingFields].join(", ")}.`,
      };
    }

    const data: QueuedRecipientData = {
      ...recipientData,
      rendered,
    };
    totalPayloadBytes += new TextEncoder().encode(JSON.stringify(data)).byteLength;
    if (totalPayloadBytes > 1_000_000) {
      return {
        ok: false,
        communicationId: 0,
        recipientCount: 0,
        message: "The rendered batch exceeds the storage limit. Shorten the message or narrow the audience.",
      };
    }
    preparedRecipients.push({
      email,
      name: member.full_name,
      data,
      token,
      tokenHash: await sha256Hex(token),
    });
  }

  if (!preparedRecipients.length) {
    return { ok: false, communicationId: 0, recipientCount: 0, message: "No eligible recipients match these filters." };
  }

  const timestamp = now.toISOString();
  const audienceName = input.audienceName?.trim().slice(0, 120) || "Filtered audience";
  const communication = await db.prepare(
    `INSERT INTO communications (name, type, status, created_by, created_at, updated_at)
     VALUES (?, 'general', 'draft', ?, ?, ?)`,
  ).bind(audienceName, normalizeEmail(input.sentBy), timestamp, timestamp).run();
  const communicationId = Number(communication.meta.last_row_id);
  if (!Number.isSafeInteger(communicationId) || communicationId < 1) {
    throw new Error("Could not create the communication batch record.");
  }

  const approvalId = crypto.randomUUID();
  const resourceId = `bulk:${communicationId}`;
  const queueRows = preparedRecipients.map((recipient) => ({
    ...recipient,
    queueKey: crypto.randomUUID(),
  }));
  const queuePlaceholders = queueRows
    .map(() => "(?, ?, ?, ?, 'pending', 0, 3, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");
  const queueValues = queueRows.flatMap((recipient) => [
    template.id,
    communicationId,
    recipient.email,
    recipient.name,
    timestamp,
    JSON.stringify(recipient.data),
    input.purpose.trim().slice(0, 80) || null,
    timestamp,
    timestamp,
    approvalId,
    recipient.queueKey,
  ]);
  const tokenPlaceholders = queueRows.map(() => "(?, ?, ?, ?)").join(", ");
  const tokenValues = queueRows.flatMap((recipient) => [
    recipient.tokenHash,
    recipient.email,
    recipient.queueKey,
    timestamp,
  ]);

  try {
    const results = await db.batch([
      approvalRequestStatement(db, {
        id: approvalId,
        resourceType: "communication",
        resourceId,
        requestedBy: input.sentBy,
        assignedTo: input.assignedTo,
        now: timestamp,
      }),
      db.prepare(
        `INSERT INTO send_queue
          (template_id, communication_id, recipient_email, recipient_name, status, attempts,
           max_attempts, created_at, recipient_data_json, purpose, scheduled_at, updated_at,
           approval_request_id, queue_key)
         VALUES ${queuePlaceholders}`,
      ).bind(...queueValues),
      db.prepare(
        `INSERT INTO unsubscribe_tokens (token_hash, email, queue_key, created_at)
         VALUES ${tokenPlaceholders}`,
      ).bind(...tokenValues),
      approvalNotificationStatement(
        db,
        approvalId,
        input.assignedTo,
        `Bulk communication awaiting approval: ${preparedRecipients.length} recipient(s).`,
        "/admin/approvals",
        timestamp,
      ),
      auditStatement(db, input.sentBy, "communication.email.batch_queued", resourceId, {
        recipientCount: preparedRecipients.length,
        template: template.name,
        audience: audienceName,
        purpose: input.purpose.trim().slice(0, 80) || null,
        approver: normalizeEmail(input.assignedTo),
      }, timestamp),
      db.prepare(
        "UPDATE communications SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'draft'",
      ).bind(timestamp, communicationId),
    ]);
    if ((results[5]?.meta.changes ?? 0) !== 1) {
      throw new Error("Communication batch could not be activated.");
    }
  } catch (error) {
    await db.prepare(
      "UPDATE communications SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'draft'",
    ).bind(timestamp, communicationId).run();
    throw error;
  }

  return {
    ok: true,
    communicationId,
    recipientCount: preparedRecipients.length,
    message: `Queued ${preparedRecipients.length} individualized message(s) for one batch approval. Delivery remains disabled until explicitly enabled.`,
  };
}

async function memberStillEligible(db: D1Database, email: string) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count, MIN(communication_consent) AS consent
     FROM members
     WHERE email = ? COLLATE NOCASE AND archived_at IS NULL AND status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM members other
         WHERE other.email = ? COLLATE NOCASE AND other.archived_at IS NULL
           AND (other.communication_consent <> 1 OR other.status = 'deceased')
       )
       AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.email = ? COLLATE NOCASE)`,
  ).bind(email, email, email).first<{ count: number; consent: number | null }>();
  return Boolean(row?.count && row.consent === 1);
}

async function sendWithResend(config: OrbitEmailConfig, email: OutboundEmail) {
  if (config.mode !== "resend" || !config.resendApiKey) {
    throw new Error("Resend delivery is not configured.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": email.idempotencyKey,
    },
    body: JSON.stringify({
      from: config.from,
      to: [email.to],
      reply_to: config.replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: {
        "List-Unsubscribe": `<${email.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(`Resend ${response.status}: ${body.message ?? "unknown error"}`);
  }
  const body = await response.json() as { id?: string };
  if (!body.id) throw new Error("Resend accepted the request without returning an email ID.");
  return body.id;
}

export async function processEmailQueue(
  db: D1Database,
  config: OrbitEmailConfig,
  deliveryEnabled: boolean,
  now = new Date(),
  limit = 20,
) {
  if (!deliveryEnabled || config.mode !== "resend" || !config.resendApiKey) {
    return { processed: 0, sent: 0, retried: 0, failed: 0, gated: true };
  }
  const timestamp = now.toISOString();
  const staleBefore = new Date(now.getTime() - 15 * 60_000).toISOString();
  await db.prepare(
    `UPDATE send_queue
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         failed_at = CASE WHEN attempts >= max_attempts THEN ? ELSE failed_at END,
         scheduled_at = ?, last_error = 'Recovered an interrupted send attempt.',
         updated_at = ? WHERE status = 'sending' AND updated_at < ?
       AND EXISTS (SELECT 1 FROM approval_requests a
                   WHERE a.id = send_queue.approval_request_id AND a.status = 'approved')`,
  ).bind(timestamp, timestamp, timestamp, staleBefore).run();
  const { results: candidates } = await db.prepare(
    `SELECT q.id FROM send_queue q
     JOIN approval_requests a ON a.id = q.approval_request_id AND a.status = 'approved'
     WHERE q.status = 'pending' AND q.scheduled_at <= ?
     ORDER BY q.scheduled_at, q.id LIMIT ?`,
  ).bind(timestamp, Math.max(1, Math.min(100, limit))).all<{ id: number }>();
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const claimed = await db.prepare(
      `UPDATE send_queue SET status = 'sending', attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND status = 'pending'
         AND EXISTS (SELECT 1 FROM approval_requests a
                     WHERE a.id = send_queue.approval_request_id AND a.status = 'approved')`,
    ).bind(timestamp, candidate.id).run();
    if ((claimed.meta.changes ?? 0) < 1) continue;

    const item = await db.prepare(
      `SELECT id, recipient_email, recipient_name, attempts, max_attempts, recipient_data_json
       FROM send_queue WHERE id = ? AND status = 'sending'`,
    ).bind(candidate.id).first<{
      id: number;
      recipient_email: string;
      recipient_name: string | null;
      attempts: number;
      max_attempts: number;
      recipient_data_json: string;
    }>();
    if (!item) continue;
    if (!(await memberStillEligible(db, item.recipient_email))) {
      await db.prepare(
        `UPDATE send_queue SET status = 'unsubscribed', last_error = ?, failed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'sending'`,
      ).bind("Recipient consent or eligibility changed before delivery.", timestamp, timestamp, item.id).run();
      failed++;
      continue;
    }
    let rendered: { subject: string; html: string; text: string };
    let unsubscribeUrl: string;
    try {
      const data = JSON.parse(item.recipient_data_json) as {
        rendered?: { subject?: unknown; html?: unknown; text?: unknown };
        unsubscribe_url?: unknown;
      };
      const content = data.rendered;
      if (
        typeof content?.subject !== "string" ||
        typeof content.html !== "string" ||
        typeof content.text !== "string" ||
        typeof data.unsubscribe_url !== "string"
      ) {
        throw new Error("Stored message content is incomplete.");
      }
      rendered = { subject: content.subject, html: content.html, text: content.text };
      unsubscribeUrl = data.unsubscribe_url;
    } catch (error) {
      await db.prepare(
        `UPDATE send_queue SET status = 'failed', last_error = ?, failed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'sending'`,
      ).bind(`Invalid queued message: ${String(error).slice(0, 250)}`, timestamp, timestamp, item.id).run();
      failed++;
      continue;
    }

    try {
      const providerId = await sendWithResend(config, {
        to: item.recipient_email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: `orbit-communication:${item.id}`,
        unsubscribeUrl,
      });
      await db.prepare(
        `UPDATE send_queue SET status = 'sent', provider_message_id = ?, sent_at = ?, processed_at = ?,
         last_error = NULL, updated_at = ? WHERE id = ? AND status = 'sending'`,
      ).bind(providerId, timestamp, timestamp, timestamp, item.id).run();
      sent++;
    } catch (error) {
      const message = String(error).slice(0, 300);
      if (item.attempts < item.max_attempts) {
        const delayMinutes = Math.min(2 ** item.attempts, 24 * 60);
        const retryAt = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
        await db.prepare(
          `UPDATE send_queue SET status = 'pending', scheduled_at = ?, last_error = ?, updated_at = ?
           WHERE id = ? AND status = 'sending'`,
        ).bind(retryAt, message, timestamp, item.id).run();
        retried++;
      } else {
        await db.prepare(
          `UPDATE send_queue SET status = 'failed', failed_at = ?, last_error = ?, updated_at = ?
           WHERE id = ? AND status = 'sending'`,
        ).bind(timestamp, message, timestamp, item.id).run();
        failed++;
      }
      console.error(`Queued communication ${item.id} failed: ${message}`);
    }
  }
  return { processed: candidates.length, sent, retried, failed, gated: false };
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyResendWebhook(
  secret: string | undefined,
  headers: Headers,
  body: string,
  now = new Date(),
) {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!secret || !id || !timestamp || !signature || !secret.startsWith("whsec_")) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(now.getTime() / 1000 - seconds) > 300) return false;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(secret.slice("whsec_".length)), (character) => character.charCodeAt(0));
  } catch {
    return false;
  }
  const keyMaterial = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyMaterial).set(keyBytes);
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  const signatures = signature.split(" ").flatMap((part) => {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) return [];
    try {
      return [Uint8Array.from(atob(value), (character) => character.charCodeAt(0))];
    } catch {
      return [];
    }
  });
  return signatures.some((candidate) => constantTimeEqual(digest, candidate));
}

export async function getUnsubscribeToken(db: D1Database, token: string) {
  if (!/^[a-f0-9-]{36}$/i.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  return db.prepare(
    "SELECT email, used_at FROM unsubscribe_tokens WHERE token_hash = ?",
  ).bind(tokenHash).first<{ email: string; used_at: string | null }>();
}

export async function unsubscribeByToken(db: D1Database, token: string, now = new Date()) {
  const existing = await getUnsubscribeToken(db, token);
  if (!existing) return { ok: false as const, alreadyUnsubscribed: false };
  if (existing.used_at) return { ok: true as const, alreadyUnsubscribed: true, email: existing.email };
  const timestamp = now.toISOString();
  const tokenHash = await sha256Hex(token);
  await db.batch([
    db.prepare("UPDATE unsubscribe_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL")
      .bind(timestamp, tokenHash),
    db.prepare(
      `INSERT OR IGNORE INTO unsubscribes (email, unsubscribe_at, created_at)
       SELECT email, ?, ? FROM unsubscribe_tokens WHERE token_hash = ?`,
    ).bind(timestamp, timestamp, tokenHash),
    db.prepare(
      `UPDATE send_queue SET status = 'unsubscribed', last_error = 'Recipient unsubscribed.',
       failed_at = ?, updated_at = ?
       WHERE recipient_email = ? COLLATE NOCASE AND status IN ('pending', 'sending')`,
    ).bind(timestamp, timestamp, existing.email),
    db.prepare(
      `UPDATE approval_requests SET status = 'cancelled', decision_by = 'recipient',
       decision_at = ?, updated_at = ?
       WHERE status = 'pending' AND resource_type = 'communication'
         AND (
           resource_id IN (SELECT queue_key FROM send_queue WHERE recipient_email = ? COLLATE NOCASE)
           OR (
             resource_id LIKE 'bulk:%'
             AND CAST(substr(resource_id, 6) AS INTEGER) IN (
               SELECT communication_id FROM send_queue
               WHERE recipient_email = ? COLLATE NOCASE AND communication_id IS NOT NULL
             )
             AND NOT EXISTS (
               SELECT 1 FROM send_queue pending_queue
               WHERE pending_queue.communication_id = CAST(substr(resource_id, 6) AS INTEGER)
                 AND pending_queue.status IN ('pending', 'sending')
             )
           )
         )`,
    ).bind(timestamp, timestamp, existing.email, existing.email),
    db.prepare(
      `UPDATE admin_notifications SET read_at = ?
       WHERE recipient = (SELECT assigned_to FROM approval_requests
                         WHERE id = admin_notifications.request_id AND status = 'cancelled'
                           AND decision_by = 'recipient' AND decision_at = ?)
         AND request_id IN (SELECT id FROM approval_requests
                            WHERE status = 'cancelled' AND decision_by = 'recipient'
                              AND decision_at = ?)`,
    ).bind(timestamp, timestamp, timestamp),
    db.prepare(
      `INSERT INTO admin_notifications (recipient, request_id, message, href, created_at)
       SELECT requested_by, id, 'A communication request was cancelled because the recipient unsubscribed.',
              '/admin/communications', ?
       FROM approval_requests
       WHERE resource_type = 'communication' AND status = 'cancelled'
         AND decision_by = 'recipient' AND decision_at = ?
         AND (
           resource_id IN (SELECT queue_key FROM send_queue WHERE recipient_email = ? COLLATE NOCASE)
           OR (
             resource_id LIKE 'bulk:%'
             AND CAST(substr(resource_id, 6) AS INTEGER) IN (
               SELECT communication_id FROM send_queue
               WHERE recipient_email = ? COLLATE NOCASE AND communication_id IS NOT NULL
             )
           )
         )`,
    ).bind(timestamp, timestamp, existing.email, existing.email),
    db.prepare(
      `INSERT INTO audit_log (at, actor, action, target, detail)
       SELECT ?, 'recipient', 'communication.unsubscribe.self_service', email, NULL
       FROM unsubscribe_tokens WHERE token_hash = ? AND used_at = ?`,
    ).bind(timestamp, tokenHash, timestamp),
  ]);
  return { ok: true as const, alreadyUnsubscribed: false, email: existing.email };
}
