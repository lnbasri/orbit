import { Form, data } from "react-router";
import {
  ArrowDownTrayIcon,
  ClipboardDocumentListIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";

import type { Route } from "./+types/communications";
import { EmptyState, Notice, PageHeader, Panel, Stat, StatGroup } from "~/components/admin";
import { TextField } from "~/components/forms";
import { buttonClass, Callout } from "~/components/ui";
import { adminEmailContext } from "~/lib/admin-context";
import { listAdmins } from "~/lib/admins.server";
import { MAX_COMMUNICATION_BATCH_RECIPIENTS } from "~/lib/communication-constants";
import { emailConfig, emailDeliveryReady } from "~/lib/config.server";
import {
  listEmailTemplates,
  queueCommunication,
  queueCommunicationBatch,
  saveEmailTemplate,
} from "~/lib/email.server";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime } from "~/lib/format";
import {
  addUnsubscribe,
  communicationRecipientsToCsv,
  getCommunicationRecipients,
  getCommunicationStats,
  listGroups,
} from "~/lib/members.server";
import { auditStatement } from "~/lib/db.server";

export function meta() {
  return [
    { title: "Communications — ORBIT" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = getAppEnv();
  const db = env.DB;
  const actor = context.get(adminEmailContext);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const status = url.searchParams.get("status") ?? "active";
  const groupId = url.searchParams.get("groupId") ?? "";
  const [stats, recipients, groups, queue, unsubscribes] = await Promise.all([
    getCommunicationStats(db),
    getCommunicationRecipients(db, { q, status, groupId }),
    listGroups(db),
    db
      .prepare(
        `SELECT q.id, q.recipient_email, q.recipient_name, q.status, q.attempts,
                q.created_at, q.purpose, q.delivered_at, q.last_error,
                t.name AS template, a.status AS approval_status
         FROM send_queue q
         JOIN email_templates t ON t.id = q.template_id
         LEFT JOIN approval_requests a ON a.id = q.approval_request_id
         ORDER BY q.created_at DESC LIMIT 50`,
      )
      .all<{
        id: number;
        recipient_email: string;
        recipient_name: string | null;
        status: string;
        attempts: number;
        created_at: string;
        purpose: string | null;
        delivered_at: string | null;
        last_error: string | null;
        template: string;
        approval_status: string | null;
      }>(),
    db
      .prepare("SELECT email, unsubscribe_at FROM unsubscribes ORDER BY unsubscribe_at DESC LIMIT 100")
      .all<{ email: string; unsubscribe_at: string }>(),
  ]);
  const [templates, admins] = await Promise.all([
    listEmailTemplates(db),
    listAdmins(db),
  ]);
  const deliveryEnabled = emailDeliveryReady(env);
  return {
    q,
    status,
    groupId,
    stats,
    recipients,
    groups,
    queue: queue.results,
    unsubscribes: unsubscribes.results,
    templates,
    approvers: admins.filter((admin) => admin.active && admin.email !== actor),
    deliveryEnabled,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const env = getAppEnv();
  const db = env.DB;
  const actor = context.get(adminEmailContext);

  if (intent === "queue-email-batch") {
    const groupId = String(form.get("groupId") ?? "");
    const group = groupId
      ? await db.prepare("SELECT name FROM groups WHERE id = ?").bind(groupId).first<{ name: string }>()
      : null;
    const recipients = await getCommunicationRecipients(db, {
      q: String(form.get("q") ?? ""),
      status: String(form.get("status") ?? ""),
      groupId,
    });
    const result = await queueCommunicationBatch(db, {
      templateName: String(form.get("templateName") ?? ""),
      recipientIds: recipients.map((recipient) => recipient.id),
      audienceName: group ? `Group: ${group.name}` : "All filtered recipients",
      fields: {
        title: String(form.get("title") ?? ""),
        content: String(form.get("content") ?? ""),
        contribution_amount: String(form.get("contributionAmount") ?? ""),
        contribution_date: String(form.get("contributionDate") ?? ""),
        invoice_number: String(form.get("invoiceNumber") ?? ""),
        due_date: String(form.get("dueDate") ?? ""),
      },
      sentBy: actor,
      assignedTo: String(form.get("assignedTo") ?? ""),
      purpose: String(form.get("purpose") ?? ""),
      publicUrl: emailConfig(env).publicUrl,
    });
    return data(result, { status: result.ok ? 200 : 400 });
  }

  if (intent === "queue-email") {
    const recipientEmail = String(form.get("recipientEmail") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    const content = String(form.get("content") ?? "").trim();
    const purpose = String(form.get("purpose") ?? "").trim();
    const result = await queueCommunication(
      db,
      {
        templateName: String(form.get("templateName") ?? ""),
        recipientEmail,
        fields: {
          title,
          content,
          contribution_amount: String(form.get("contributionAmount") ?? ""),
          contribution_date: String(form.get("contributionDate") ?? ""),
          invoice_number: String(form.get("invoiceNumber") ?? ""),
          due_date: String(form.get("dueDate") ?? ""),
        },
        sentBy: actor,
        assignedTo: String(form.get("assignedTo") ?? ""),
        purpose,
        publicUrl: emailConfig(env).publicUrl,
      },
    );
    return data(result, { status: result.ok ? 200 : 400 });
  }

  if (intent === "save-template") {
    const active = String(form.get("active") ?? "") === "1";
    const id = Number(form.get("templateId") ?? "");
    const result = await saveEmailTemplate(db, actor, {
      id: Number.isInteger(id) && id > 0 ? id : undefined,
      name: String(form.get("name") ?? ""),
      subject: String(form.get("subject") ?? ""),
      html: String(form.get("html") ?? ""),
      text: String(form.get("text") ?? ""),
      kind: String(form.get("kind") ?? "general"),
      active,
    });
    return data(result, { status: result.ok ? 200 : 400 });
  }
  if (intent === "add-unsubscribe") {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return data({ ok: false, message: "Enter a valid email address." }, { status: 400 });
    }
    await addUnsubscribe(db, email);
    await auditStatement(
      db,
      actor,
      "communication.unsubscribe.add",
      email,
      null,
      new Date().toISOString(),
    ).run();
    return data({ ok: true, message: "Address added to the unsubscribe list." });
  }

  if (intent === "export-recipients") {
    const recipients = await getCommunicationRecipients(db, {
      q: String(form.get("q") ?? ""),
      status: String(form.get("status") ?? ""),
      groupId: String(form.get("groupId") ?? ""),
    });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
    return new Response(communicationRecipientsToCsv(recipients), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="orbit-communications-${stamp}.csv"`,
      },
    });
  }

  return data({ ok: false, message: "Unknown action." }, { status: 400 });
}

export default function Communications({ loaderData, actionData }: Route.ComponentProps) {
  const { stats, recipients, groups, queue, unsubscribes, templates, approvers, deliveryEnabled, q, status, groupId } = loaderData;
  return (
    <div>
      <PageHeader
        eyebrow="Communications"
        title="Communications"
        description="Prepare general communications, manage reusable email templates, and review delivery status."
      />
      <Notice result={actionData} className="mb-5" />
      <Callout tone="warning" icon={ExclamationTriangleIcon} title="Approval and delivery gate">
        Messages require approval by a different active administrator. Resend delivery is currently {deliveryEnabled ? "enabled" : "disabled"}; the delivery flag, Resend mode, and API key must all be configured before the queue can send.
      </Callout>

      <StatGroup>
        <Stat icon={ClipboardDocumentListIcon} label="Queued" value={stats.total} />
        <Stat icon={EnvelopeIcon} label="Sent" value={stats.sent} />
        <Stat icon={ExclamationTriangleIcon} label="Failed" value={stats.failed} />
        <Stat icon={UsersIcon} label="Eligible recipients" value={recipients.length} />
      </StatGroup>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title="Queue a message" icon={EnvelopeIcon}>
          <Form method="post" className="grid gap-3">
            <input type="hidden" name="q" value={q} />
            <input type="hidden" name="status" value={status} />
            <input type="hidden" name="groupId" value={groupId} />
            <label className="text-sm font-medium text-slate-700">
              Template
              <select name="templateName" required className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                <option value="">Select a template</option>
                {templates.filter((template) => template.is_active).map((template) => (
                  <option key={template.id} value={template.name}>{template.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Recipient (opted-in members matching the audience filters)
              <select name="recipientEmail" required className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                <option value="">Select a recipient</option>
                {recipients.map((member) => (
                  <option key={member.id} value={member.email ?? ""}>
                    {member.full_name} — {member.email}
                  </option>
                ))}
              </select>
            </label>
            <TextField name="title" label="Title (for notices)" maxLength={160} />
            <label className="text-sm font-medium text-slate-700">
              Message (for notices)
              <textarea name="content" rows={5} maxLength={10000} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
            </label>
            <TextField name="contributionAmount" label="Contribution amount (optional)" maxLength={80} />
            <TextField name="contributionDate" label="Contribution date (optional)" type="date" />
            <TextField name="invoiceNumber" label="Invoice number (optional)" maxLength={80} />
            <TextField name="dueDate" label="Due date (optional)" type="date" />
            <TextField name="purpose" label="Purpose" maxLength={80} />
            <label className="text-sm font-medium text-slate-700">
              Approver
              <select name="assignedTo" required className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                <option value="">Select a different administrator</option>
                {approvers.map((admin) => <option key={admin.email} value={admin.email}>{admin.name || admin.email}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                name="intent"
                value="queue-email"
                disabled={!recipients.length || !approvers.length || !templates.some((template) => template.is_active)}
                className={buttonClass("primary", "md")}
              >
                Submit one for approval
              </button>
              <button
                type="submit"
                name="intent"
                value="queue-email-batch"
                formNoValidate
                disabled={
                  !recipients.length ||
                  recipients.length > MAX_COMMUNICATION_BATCH_RECIPIENTS ||
                  status !== "active" ||
                  !approvers.length ||
                  !templates.some((template) => template.is_active)
                }
                className={buttonClass("secondary", "md")}
              >
                Queue {recipients.length} for batch approval
              </button>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              Batch messages are personalized per recipient, reviewed in one approval, and limited to {MAX_COMMUNICATION_BATCH_RECIPIENTS} recipients. Delivery remains subject to consent and unsubscribe checks.
            </p>
            {recipients.length > MAX_COMMUNICATION_BATCH_RECIPIENTS && (
              <p className="text-sm text-amber-800">Narrow the audience filters to queue a smaller batch.</p>
            )}
            {recipients.length > 0 && status !== "active" && (
              <p className="text-sm text-amber-800">Bulk messages are limited to active members. Select Active status to queue this audience.</p>
            )}
            {!approvers.length && <p className="text-sm text-amber-800">Add another active administrator before creating an approval request.</p>}
          </Form>
        </Panel>

        <Panel
          title={<>Eligible recipients <span className="text-slate-400 tabular-nums">({recipients.length})</span></>}
          icon={UsersIcon}
          actions={
            <Form method="post">
              <input type="hidden" name="intent" value="export-recipients" />
              <input type="hidden" name="q" value={q} />
              <input type="hidden" name="status" value={status} />
              <input type="hidden" name="groupId" value={groupId} />
              <button type="submit" className={buttonClass("secondary", "sm")}>
                <ArrowDownTrayIcon className="size-4" aria-hidden="true" /> Export CSV
              </button>
            </Form>
          }
        >
          <Form method="get" className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <TextField name="q" label="Search" defaultValue={q} placeholder="Name, email, or phone" />
            <label className="text-sm font-medium text-slate-700">
              Status
              <select name="status" defaultValue={status} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="moved">Moved</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Group
              <select name="groupId" defaultValue={groupId} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                <option value="">All groups</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
            <button type="submit" className={buttonClass("secondary", "md")}>Filter</button>
          </Form>
          <p className="mb-3 text-xs leading-5 text-slate-500">
            Only members with communication consent, an email address, and no unsubscribe record are shown. The selected group also filters the recipient choices above and the CSV export.
          </p>
          {recipients.length ? (
            <ul className="divide-y divide-slate-100">
              {recipients.slice(0, 20).map((member) => (
                <li key={member.id} className="flex justify-between gap-3 py-2 text-sm">
                  <span className="font-medium text-slate-700">{member.full_name}</span>
                  <span className="text-slate-500">{member.email}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={UsersIcon}>No eligible members match these filters.</EmptyState>}
        </Panel>

        <Panel title="Message queue" icon={ClipboardDocumentListIcon} flush>
          {queue.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs text-slate-500">
                  <tr><th className="px-4 py-2">Template</th><th className="px-4 py-2">Recipient</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Added</th></tr>
                </thead>
                <tbody>
                  {queue.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100">
                      <td className="px-4 py-3">{item.template}</td>
                      <td className="px-4 py-3">{item.recipient_name || item.recipient_email}<span className="block text-xs text-slate-500">{item.recipient_email}</span></td>
                      <td className="px-4 py-3 capitalize">
                        {item.approval_status === "pending" ? "awaiting approval" : item.delivered_at ? "delivered" : item.status}
                        {item.last_error && <span className="block max-w-64 text-xs text-red-700">{item.last_error}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon={ClipboardDocumentListIcon}>The queue is empty.</EmptyState>}
        </Panel>

        <Panel title="Email templates" icon={EnvelopeIcon} flush>
          <div className="divide-y divide-slate-100">
            {templates.map((template) => (
              <Form key={template.id} method="post" className="grid gap-3 p-4 sm:p-5">
                <input type="hidden" name="intent" value="save-template" />
                <input type="hidden" name="templateId" value={template.id} />
                <TextField name="name" label="Template key" required maxLength={40} defaultValue={template.name} />
                <TextField name="subject" label="Subject" required maxLength={200} defaultValue={template.subject} />
                <TextField name="kind" label="Category" maxLength={40} defaultValue={template.kind} />
                <label className="text-sm font-medium text-slate-700">
                  HTML body
                  <textarea name="html" required rows={5} maxLength={30000} defaultValue={template.html} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900" />
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Plain-text body
                  <textarea name="text" rows={4} maxLength={30000} defaultValue={template.text ?? ""} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900" />
                </label>
                <p className="text-xs text-slate-500">Merge fields include {"{{full_name}}"}, {"{{preferred_name}}"}, {"{{household_name}}"}, {"{{title}}"}, {"{{content}}"}, invoice/contribution fields, and {"{{unsubscribe_url}}"}.</p>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="active" value="1" defaultChecked={template.is_active === 1} className="size-4 rounded border-slate-300" />
                  Available for new messages
                </label>
                <button type="submit" className={buttonClass("secondary", "sm")}>Save template</button>
              </Form>
            ))}
            {!templates.length && <EmptyState icon={EnvelopeIcon}>No email templates are configured.</EmptyState>}
            <Form method="post" className="grid gap-3 p-4 sm:p-5">
              <input type="hidden" name="intent" value="save-template" />
              <h2 className="font-semibold text-slate-900">Add an email template</h2>
              <TextField name="name" label="Template key" required maxLength={40} />
              <TextField name="subject" label="Subject" required maxLength={200} />
              <TextField name="kind" label="Category" maxLength={40} defaultValue="general" />
              <label className="text-sm font-medium text-slate-700">
                HTML body
                <textarea name="html" required rows={5} maxLength={30000} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900" />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Plain-text body
                <textarea name="text" rows={4} maxLength={30000} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900" />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="active" value="1" defaultChecked className="size-4 rounded border-slate-300" />
                Available for new messages
              </label>
              <button type="submit" className={buttonClass("primary", "md")}>Add template</button>
            </Form>
          </div>
        </Panel>

        <Panel title="Unsubscribes" icon={ExclamationTriangleIcon}>
          <Form method="post" className="mb-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="add-unsubscribe" />
            <TextField name="email" label="Email address" type="email" required className="min-w-60 flex-1" />
            <button type="submit" className={buttonClass("secondary", "md")}>Add unsubscribe</button>
          </Form>
          {unsubscribes.length ? (
            <ul className="divide-y divide-slate-100">
              {unsubscribes.map((item) => (
                <li key={item.email} className="flex justify-between gap-3 py-2 text-sm">
                  <span className="text-slate-700">{item.email}</span>
                  <time className="text-xs text-slate-500" dateTime={item.unsubscribe_at}>{formatDateTime(item.unsubscribe_at)}</time>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={ExclamationTriangleIcon}>No unsubscribes recorded.</EmptyState>}
        </Panel>
      </div>
    </div>
  );
}
