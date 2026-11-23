import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addUnsubscribe,
  getCommunicationRecipients,
  getCommunicationStats,
} from "../app/lib/members.server";
import { createApprovalReminders, decideApproval } from "../app/lib/approvals.server";
import { emailDeliveryReady } from "../app/lib/config.server";
import {
  processEmailQueue,
  queueCommunication,
  queueCommunicationBatch,
  unsubscribeByToken,
  verifyResendWebhook,
} from "../app/lib/email.server";
import { emailCfg, resetDb, startDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => resetDb(db));

async function addAdmins() {
  const timestamp = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO admins (email, role, active, added_by, added_at) VALUES (?, 'SUPER_ADMIN', 1, 'test', ?)")
      .bind("sender@example.org", timestamp),
    db.prepare("INSERT INTO admins (email, role, active, added_by, added_at) VALUES (?, 'ADMIN', 1, 'test', ?)")
      .bind("reviewer@example.org", timestamp),
  ]);
}

async function addMember(
  name: string,
  email: string,
  consent: boolean,
  status = "active",
) {
  const [firstName, ...familyParts] = name.split(" ");
  const familyName = familyParts.join(" ") || firstName;
  const result = await db
    .prepare(
      `INSERT INTO members
        (id, full_name, first_name, family_name, gender, communication_consent,
         email, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'female', ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      name,
      firstName,
      familyName,
      consent ? 1 : 0,
      email,
      status,
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
  return result;
}

async function addGroup(name: string) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db
    .prepare("INSERT INTO groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(id, name, timestamp, timestamp)
    .run();
  return id;
}

async function assignToGroup(
  name: string,
  email: string,
  groupId: string,
  validUntil: string | null = null,
) {
  const member = await db
    .prepare("SELECT id FROM members WHERE full_name = ? AND email = ?")
    .bind(name, email)
    .first<{ id: string }>();
  if (!member) throw new Error(`Test member not found: ${name}`);
  await db
    .prepare(
      `INSERT INTO member_group_memberships
        (member_id, group_id, role, assigned_by, valid_from, valid_until)
       VALUES (?, ?, 'member', 'test', ?, ?)`,
    )
    .bind(member.id, groupId, new Date().toISOString(), validUntil)
    .run();
}

describe("communications local queue", () => {
  it("requires the explicit flag, Resend credentials, and a valid HTTPS application URL", () => {
    const config = {
      ENABLE_EMAIL_DELIVERY: "true",
      EMAIL_MODE: "resend",
      RESEND_API_KEY: "test-key",
      PUBLIC_APP_URL: "https://orbit.example.org",
    };
    expect(emailDeliveryReady(config)).toBe(true);
    expect(emailDeliveryReady({ ...config, ENABLE_EMAIL_DELIVERY: "false" })).toBe(false);
    expect(emailDeliveryReady({ ...config, PUBLIC_APP_URL: "http://localhost:5173" })).toBe(false);
    expect(emailDeliveryReady({ ...config, PUBLIC_APP_URL: "not-a-url" })).toBe(false);
  });

  it("uses a general template kind by default", async () => {
    await db
      .prepare(
        "INSERT INTO email_templates (name, subject, html, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind("general", "Subject", "<p>Message</p>", new Date().toISOString(), new Date().toISOString())
      .run();

    expect(await db.prepare("SELECT kind FROM email_templates WHERE name = ?").bind("general").first())
      .toEqual({ kind: "general" });
  });

  it("queues a consented member locally without marking it sent", async () => {
    await addAdmins();
    await addMember("Ada Lovelace", "ada@example.org", true);

    const result = await queueCommunication(
      db,
      {
        templateName: "notice",
        recipientEmail: "ada@example.org",
        fields: { title: "Meeting", content: "Details" },
        sentBy: "sender@example.org",
        assignedTo: "reviewer@example.org",
        purpose: "general_notice",
      },
      new Date("2026-11-23T10:00:00.000Z"),
    );

    expect(result).toMatchObject({
      ok: true,
      message: "Message queued and submitted for approval. Delivery remains disabled until explicitly enabled.",
    });
    const row = await db
      .prepare(
        `SELECT q.status, q.recipient_email, q.purpose, q.communication_id, t.name AS template,
                a.status AS approval_status, a.assigned_to
         FROM send_queue q JOIN email_templates t ON t.id = q.template_id
         JOIN approval_requests a ON a.id = q.approval_request_id
         WHERE q.id = ?`,
      )
      .bind(result.id)
      .first();
    expect(row).toEqual({
      status: "pending",
      recipient_email: "ada@example.org",
      purpose: "general_notice",
      communication_id: null,
      template: "notice",
      approval_status: "pending",
      assigned_to: "reviewer@example.org",
    });
    expect(await getCommunicationStats(db)).toMatchObject({
      total: 1,
      sent: 0,
      failed: 0,
    });
  });

  it("refuses to queue recipients without consent or with an unsubscribe record", async () => {
    await addAdmins();
    await addMember("No Consent", "no-consent@example.org", false);
    await addMember("Opted Out", "opted-out@example.org", true);
    await addMember("Shared Opted Out", "shared@example.org", false);
    await addMember("Shared Consented", "shared@example.org", true);
    await addMember("Inactive Member", "inactive@example.org", true, "inactive");
    await addMember("Deceased Shared", "deceased-shared@example.org", true, "deceased");
    await addMember("Living Shared", "deceased-shared@example.org", true);
    await addUnsubscribe(db, "opted-out@example.org");

    const queue = (recipientEmail: string) => queueCommunication(db, {
      templateName: "welcome",
      recipientEmail,
      fields: {},
      sentBy: "sender@example.org",
      assignedTo: "reviewer@example.org",
      purpose: "",
    });
    const noConsent = await queue("no-consent@example.org");
    const optedOut = await queue("opted-out@example.org");
    const sharedAddress = await queue("shared@example.org");
    const inactiveMember = await queue("inactive@example.org");
    const deceasedSharedAddress = await queue("deceased-shared@example.org");

    expect(noConsent.ok).toBe(false);
    expect(optedOut).toMatchObject({ ok: false, message: "Recipient has unsubscribed." });
    expect(sharedAddress.ok).toBe(false);
    expect(inactiveMember.ok).toBe(false);
    expect(deceasedSharedAddress.ok).toBe(false);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM send_queue").first()).toEqual({ count: 0 });
  });

  it("limits eligible recipients to consented members with email and no unsubscribe", async () => {
    await addMember("Eligible Member", "eligible@example.org", true);
    await addMember("No Consent", "no-consent@example.org", false);
    await addMember("Opted Out", "opted-out@example.org", true);
    await addMember("Inactive Member", "inactive@example.org", true, "inactive");
    await addUnsubscribe(db, "opted-out@example.org");

    const recipients = await getCommunicationRecipients(db);

    expect(recipients.map((member) => member.email)).toEqual(["eligible@example.org"]);
  });

  it("filters recipients by current group membership and retains consent safeguards", async () => {
    const groupId = await addGroup("Committee");
    const now = new Date().toISOString();
    await addMember("Outside Group", "shared@example.org", true);
    await addMember("Selected Member", "shared@example.org", true);
    await addMember("Former Member", "former@example.org", true);
    await addMember("No Consent", "no-consent@example.org", false);
    await addMember("Unsubscribed", "unsubscribed@example.org", true);
    await assignToGroup("Selected Member", "shared@example.org", groupId);
    await assignToGroup("Former Member", "former@example.org", groupId, now);
    await assignToGroup("No Consent", "no-consent@example.org", groupId);
    await assignToGroup("Unsubscribed", "unsubscribed@example.org", groupId);
    await addUnsubscribe(db, "unsubscribed@example.org");

    const recipients = await getCommunicationRecipients(db, { groupId });

    expect(recipients.map((member) => member.full_name)).toEqual(["Selected Member"]);
  });

  it("queues a group audience under one approval and delivers each personalized message", async () => {
    await addAdmins();
    const groupId = await addGroup("Committee");
    await addMember("Alice Member", "alice@example.org", true);
    await addMember("Bob Member", "bob@example.org", true);
    await addMember("Outside Member", "outside@example.org", true);
    await assignToGroup("Alice Member", "alice@example.org", groupId);
    await assignToGroup("Bob Member", "bob@example.org", groupId);
    const recipients = await getCommunicationRecipients(db, { groupId });

    const batch = await queueCommunicationBatch(
      db,
      {
        templateName: "welcome",
        recipientIds: recipients.map((member) => member.id),
        audienceName: "Group: Committee",
        fields: {},
        sentBy: "sender@example.org",
        assignedTo: "reviewer@example.org",
        purpose: "committee_update",
      },
      new Date("2026-11-23T10:00:00.000Z"),
    );

    expect(batch).toMatchObject({ ok: true, recipientCount: 2 });
    const rows = await db.prepare(
      `SELECT recipient_email, recipient_data_json, approval_request_id, communication_id
       FROM send_queue ORDER BY recipient_email`,
    ).all<{
      recipient_email: string;
      recipient_data_json: string;
      approval_request_id: string;
      communication_id: number;
    }>();
    expect(rows.results).toHaveLength(2);
    expect(new Set(rows.results.map((row) => row.approval_request_id)).size).toBe(1);
    expect(rows.results.map((row) => row.recipient_email)).toEqual([
      "alice@example.org",
      "bob@example.org",
    ]);
    expect(rows.results.map((row) => {
      const data = JSON.parse(row.recipient_data_json) as {
        rendered: { text: string };
        unsubscribe_url: string;
      };
      return {
        text: data.rendered.text,
        unsubscribeUrl: data.unsubscribe_url,
      };
    })).toEqual([
      {
        text: expect.stringContaining("Welcome to ORBIT, Alice Member!\\n\\n"),
        unsubscribeUrl: expect.stringContaining("/unsubscribe?token="),
      },
      {
        text: expect.stringContaining("Welcome to ORBIT, Bob Member!\\n\\n"),
        unsubscribeUrl: expect.stringContaining("/unsubscribe?token="),
      },
    ]);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM unsubscribe_tokens").first())
      .toEqual({ count: 2 });

    const approval = await db.prepare(
      "SELECT id, resource_id FROM approval_requests WHERE resource_type = 'communication'",
    ).first<{ id: string; resource_id: string }>();
    expect(approval?.resource_id).toBe(`bulk:${batch.communicationId}`);
    const approvalPreview = await db.prepare(
      `SELECT a.id, a.resource_type, a.requested_by, a.created_at,
              COALESCE(d.title, t.name || ': ' || COALESCE(c.name, q.recipient_email)) AS title,
              CASE WHEN c.id IS NOT NULL THEN (
                SELECT CAST(COUNT(*) AS TEXT) || ' recipients'
               FROM send_queue batch_queue
                WHERE batch_queue.communication_id = c.id AND batch_queue.status = 'pending'
              ) ELSE COALESCE(m.full_name, h.name, q.recipient_name, q.recipient_email) END AS recipient,
              (SELECT GROUP_CONCAT(
                        COALESCE(recipient_name, '') || ' <' || recipient_email || '>',
                        char(10)
                      )
               FROM send_queue batch_recipients
               WHERE batch_recipients.communication_id = c.id
                 AND batch_recipients.status = 'pending') AS batch_recipients,
              d.rendered_text AS document_content,
              COALESCE(q.recipient_data_json, batch_queue.recipient_data_json) AS message_data,
              (SELECT GROUP_CONCAT(author || ': ' || body, char(10))
               FROM approval_comments c WHERE c.request_id = a.id) AS comments
       FROM approval_requests a
       LEFT JOIN generated_documents d ON a.resource_type = 'document' AND d.id = a.resource_id
       LEFT JOIN send_queue q ON a.resource_type = 'communication' AND q.queue_key = a.resource_id
       LEFT JOIN communications c ON a.resource_type = 'communication' AND a.resource_id = 'bulk:' || c.id
       LEFT JOIN send_queue batch_queue ON batch_queue.id = (
         SELECT MIN(candidate.id) FROM send_queue candidate
         WHERE candidate.communication_id = c.id AND candidate.status = 'pending'
       )
       LEFT JOIN email_templates t ON t.id = COALESCE(q.template_id, batch_queue.template_id)
       LEFT JOIN members m ON m.id = d.member_id
       LEFT JOIN households h ON h.id = d.household_id
       WHERE a.status = 'pending' AND a.assigned_to = ?`,
    ).bind("reviewer@example.org").first<{
      id: string;
      title: string;
      recipient: string;
      batch_recipients: string;
      message_data: string;
    }>();
    expect(approvalPreview).toMatchObject({
      title: "welcome: Group: Committee",
      recipient: "2 recipients",
    });
    expect(approvalPreview?.batch_recipients).toContain("Alice Member <alice@example.org>");
    expect(approvalPreview?.batch_recipients).toContain("Bob Member <bob@example.org>");
    expect(await decideApproval(db, approval!.id, "reviewer@example.org", "approved"))
      .toMatchObject({ ok: true });
    expect(await db.prepare(
      "SELECT q.status, a.status AS approval_status FROM send_queue q JOIN approval_requests a ON a.id = q.approval_request_id",
    ).all()).toMatchObject({ results: [{ status: "pending", approval_status: "approved" }, { status: "pending", approval_status: "approved" }] });

    let providerMessage = 0;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ id: `resend-${++providerMessage}` }), { status: 200 }),
    );
    const result = await processEmailQueue(
      db,
      { ...emailCfg, mode: "resend", resendApiKey: "test-key" },
      true,
      new Date("2026-11-23T10:05:00.000Z"),
    );
    fetch.mockRestore();
    expect(result).toEqual({ processed: 2, sent: 2, retried: 0, failed: 0, gated: false });
    expect(await db.prepare("SELECT status FROM communications WHERE id = ?")
      .bind(batch.communicationId).first()).toEqual({ status: "completed" });
  });

  it("rejects oversized or newly ineligible bulk audiences before creating records", async () => {
    const tooLarge = await queueCommunicationBatch(db, {
      templateName: "welcome",
      recipientIds: Array.from({ length: 51 }, (_, index) => `member-${index}`),
      fields: {},
      sentBy: "sender@example.org",
      assignedTo: "reviewer@example.org",
      purpose: "",
    });
    expect(tooLarge).toMatchObject({ ok: false, message: expect.stringContaining("limited to 50") });

    await addAdmins();
    await addMember("Eligible Member", "eligible@example.org", true);
    await addMember("No Consent", "no-consent@example.org", false);
    const eligible = await getCommunicationRecipients(db);
    const ineligible = await db.prepare("SELECT id FROM members WHERE email = ?")
      .bind("no-consent@example.org").first<{ id: string }>();
    const rejected = await queueCommunicationBatch(db, {
      templateName: "welcome",
      recipientIds: [eligible[0].id, ineligible!.id],
      fields: {},
      sentBy: "sender@example.org",
      assignedTo: "reviewer@example.org",
      purpose: "",
    });

    expect(rejected).toMatchObject({ ok: false, message: expect.stringContaining("no longer eligible") });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM communications").first()).toEqual({ count: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM send_queue").first()).toEqual({ count: 0 });
  });

  it("rejecting a bulk approval fails every queued recipient", async () => {
    await addAdmins();
    await addMember("Alice Member", "alice@example.org", true);
    const recipients = await getCommunicationRecipients(db);
    const batch = await queueCommunicationBatch(db, {
      templateName: "welcome",
      recipientIds: recipients.map((member) => member.id),
      fields: {},
      sentBy: "sender@example.org",
      assignedTo: "reviewer@example.org",
      purpose: "general_notice",
    });
    const approval = await db.prepare(
      "SELECT id FROM approval_requests WHERE resource_type = 'communication'",
    ).first<{ id: string }>();

    expect(await decideApproval(db, approval!.id, "reviewer@example.org", "rejected", "Needs revision"))
      .toMatchObject({ ok: true });
    expect(await db.prepare("SELECT status FROM send_queue").first()).toEqual({ status: "failed" });
    expect(await db.prepare("SELECT status FROM communications WHERE id = ?")
      .bind(batch.ok ? batch.communicationId : 0).first()).toEqual({ status: "failed" });
  });

  it("keeps a batch pending after one unsubscribe and cancels it when nobody remains", async () => {
    await addAdmins();
    await addMember("Alice Member", "alice@example.org", true);
    await addMember("Bob Member", "bob@example.org", true);
    const recipients = await getCommunicationRecipients(db);
    await queueCommunicationBatch(db, {
      templateName: "welcome",
      recipientIds: recipients.map((member) => member.id),
      fields: {},
      sentBy: "sender@example.org",
      assignedTo: "reviewer@example.org",
      purpose: "general_notice",
    });
    const rows = await db.prepare(
      "SELECT recipient_email, recipient_data_json FROM send_queue ORDER BY recipient_email",
    ).all<{ recipient_email: string; recipient_data_json: string }>();
    const tokenFor = (row: typeof rows.results[number]) => {
      const data = JSON.parse(row.recipient_data_json) as { unsubscribe_url: string };
      return new URL(data.unsubscribe_url).searchParams.get("token")!;
    };
    const approvalId = await db.prepare(
      "SELECT id FROM approval_requests WHERE resource_type = 'communication'",
    ).first<{ id: string }>();

    await unsubscribeByToken(db, tokenFor(rows.results[0]));
    expect(await db.prepare("SELECT status FROM approval_requests WHERE id = ?")
      .bind(approvalId!.id).first()).toEqual({ status: "pending" });
    expect(await db.prepare(
      "SELECT status FROM send_queue ORDER BY recipient_email",
    ).all()).toMatchObject({
      results: [{ status: "unsubscribed" }, { status: "pending" }],
    });

    await unsubscribeByToken(db, tokenFor(rows.results[1]));
    expect(await db.prepare("SELECT status FROM approval_requests WHERE id = ?")
      .bind(approvalId!.id).first()).toEqual({ status: "cancelled" });
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM admin_notifications WHERE recipient = 'sender@example.org' AND request_id = ?",
    ).bind(approvalId!.id).first()).toEqual({ count: 1 });
  });

  it("never sends while gated or awaiting approval, then sends only after approval", async () => {
    await addAdmins();
    await addMember("Ada Lovelace", "ada@example.org", true);
    const queued = await queueCommunication(db, {
      templateName: "notice",
      recipientEmail: "ada@example.org",
      fields: { title: "Meeting", content: "Details" },
      sentBy: "sender@example.org",
      assignedTo: "reviewer@example.org",
      purpose: "general_notice",
    }, new Date("2026-11-23T10:00:00.000Z"));
    expect(queued.ok).toBe(true);

    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "resend-1" }), { status: 200 }),
    );
    const resendConfig = { ...emailCfg, mode: "resend" as const, resendApiKey: "test-key" };
    expect(await processEmailQueue(db, resendConfig, false, new Date("2026-11-23T10:05:00.000Z")))
      .toMatchObject({ gated: true, sent: 0 });
    expect(fetch).not.toHaveBeenCalled();

    const approval = await db.prepare(
      "SELECT id FROM approval_requests WHERE resource_type = 'communication'",
    ).first<{ id: string }>();
    expect(approval).not.toBeNull();
    expect(await processEmailQueue(db, resendConfig, true, new Date("2026-11-23T10:05:00.000Z")))
      .toMatchObject({ sent: 0 });
    expect(fetch).not.toHaveBeenCalled();

    expect(await decideApproval(db, approval!.id, "sender@example.org", "approved"))
      .toMatchObject({ ok: false });
    expect(await decideApproval(db, approval!.id, "reviewer@example.org", "approved"))
      .toMatchObject({ ok: true });
    expect(await processEmailQueue(db, resendConfig, true, new Date("2026-11-23T10:10:00.000Z")))
      .toMatchObject({ sent: 1, failed: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await db.prepare("SELECT status, provider_message_id FROM send_queue WHERE id = ?")
      .bind(queued.id).first()).toEqual({ status: "sent", provider_message_id: "resend-1" });
    fetch.mockRestore();
  });

  it("verifies Resend webhook signatures and rejects tampered or stale events", async () => {
    const now = new Date("2026-11-23T10:00:00.000Z");
    const id = "webhook-1";
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "resend-1" } });
    const keyBytes = new TextEncoder().encode("test webhook secret");
    const keyMaterial = new ArrayBuffer(keyBytes.byteLength);
    new Uint8Array(keyMaterial).set(keyBytes);
    const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${id}.${timestamp}.${body}`),
    ));
    const secret = `whsec_${btoa(String.fromCharCode(...keyBytes))}`;
    const headers = new Headers({
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${btoa(String.fromCharCode(...digest))}`,
    });

    expect(await verifyResendWebhook(secret, headers, body, now)).toBe(true);
    expect(await verifyResendWebhook(secret, headers, `${body} `, now)).toBe(false);
    expect(await verifyResendWebhook(secret, headers, body, new Date(now.getTime() + 301_000))).toBe(false);
  });

  it("creates in-app approval reminders no more than once per day", async () => {
    await addAdmins();
    await addMember("Ada Lovelace", "ada@example.org", true);
    await queueCommunication(db, {
      templateName: "notice",
      recipientEmail: "ada@example.org",
      fields: { title: "Meeting", content: "Details" },
      sentBy: "sender@example.org",
      assignedTo: "reviewer@example.org",
      purpose: "general_notice",
    }, new Date("2026-11-23T10:00:00.000Z"));

    const firstReminderAt = new Date("2026-11-24T11:00:00.000Z");
    expect(await createApprovalReminders(db, firstReminderAt)).toBe(1);
    expect(await createApprovalReminders(db, firstReminderAt)).toBe(0);
    expect(await createApprovalReminders(db, new Date("2026-11-25T10:59:00.000Z"))).toBe(0);
    expect(await createApprovalReminders(db, new Date("2026-11-25T11:00:00.000Z"))).toBe(1);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM admin_notifications WHERE recipient = ?")
      .bind("reviewer@example.org").first()).toEqual({ count: 3 });
  });

  it("supports tokenized unsubscribe and cancels pending deliveries", async () => {
    await addAdmins();
    await addMember("Ada Lovelace", "ada@example.org", true);
    const queued = await queueCommunication(db, {
      templateName: "notice",
      recipientEmail: "ada@example.org",
      fields: { title: "Meeting", content: "Details" },
      sentBy: "sender@example.org",
      assignedTo: "reviewer@example.org",
      purpose: "general_notice",
      publicUrl: "https://orbit.example.org",
    });
    expect(queued.ok).toBe(true);
    const row = await db.prepare("SELECT recipient_data_json FROM send_queue WHERE id = ?")
      .bind(queued.id).first<{ recipient_data_json: string }>();
    const content = JSON.parse(row!.recipient_data_json) as { unsubscribe_url: string };
    const token = new URL(content.unsubscribe_url).searchParams.get("token")!;

    expect(await unsubscribeByToken(db, token, new Date("2026-11-23T11:00:00.000Z")))
      .toMatchObject({ ok: true, alreadyUnsubscribed: false, email: "ada@example.org" });
    expect(await unsubscribeByToken(db, token)).toMatchObject({ ok: true, alreadyUnsubscribed: true });
    expect(await db.prepare("SELECT status FROM send_queue WHERE id = ?").bind(queued.id).first())
      .toEqual({ status: "unsubscribed" });
    expect(await db.prepare("SELECT status FROM approval_requests WHERE resource_type = 'communication'")
      .first()).toEqual({ status: "cancelled" });
    expect(await db.prepare("SELECT email FROM unsubscribes WHERE email = ?")
      .bind("ada@example.org").first()).toEqual({ email: "ada@example.org" });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM admin_notifications WHERE recipient = ? AND read_at IS NULL")
      .bind("reviewer@example.org").first()).toEqual({ count: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM admin_notifications WHERE recipient = ? AND read_at IS NULL")
      .bind("sender@example.org").first()).toEqual({ count: 1 });
  });
});
