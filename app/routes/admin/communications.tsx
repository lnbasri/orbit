import { Form, data } from "react-router";
import { useState } from "react";
import {
  ArrowDownTrayIcon,
  ClipboardDocumentListIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  MinusIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";

import type { Route } from "./+types/communications";
import { EmptyState, Notice, PageHeader, Panel, Stat, StatGroup } from "~/components/admin";
import { TextField } from "~/components/forms";
import { buttonClass, Callout } from "~/components/ui";
import { adminAccessContext, adminEmailContext } from "~/lib/admin-context";
import { hasAdminCapability } from "~/lib/admin-access";
import { listAdmins } from "~/lib/admins.server";
import { MAX_COMMUNICATION_BATCH_RECIPIENTS } from "~/lib/communication-constants";
import { emailConfig, emailDeliveryReady } from "~/lib/config.server";
import {
  EMAIL_TEMPLATE_INPUT_FIELDS,
  renderEmailTemplate,
  resolveEmailTemplateInputFields,
  type EmailTemplateInputField,
} from "~/lib/email-template";
import {
  deleteEmailTemplate,
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

const COMPOSER_FIELD_NAMES: Record<EmailTemplateInputField, string> = {
  title: "title",
  content: "content",
  contribution_amount: "contributionAmount",
  contribution_date: "contributionDate",
  invoice_number: "invoiceNumber",
  due_date: "dueDate",
};

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
  const access = context.get(adminAccessContext);
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
  const [templates, admins, templateReferences] = await Promise.all([
    listEmailTemplates(db),
    listAdmins(db),
    db.prepare(
      "SELECT template_id, COUNT(*) AS reference_count FROM send_queue GROUP BY template_id",
    ).all<{ template_id: number; reference_count: number }>(),
  ]);
  const templateReferenceCounts = Object.fromEntries(
    templateReferences.results.map(({ template_id, reference_count }) => [template_id, reference_count]),
  );
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
    templates: templates.map((template) => ({
      ...template,
      inputFields: resolveEmailTemplateInputFields(template.input_fields_json, template),
    })),
    templateReferenceCounts,
    approvers: admins.filter((admin) => admin.active && admin.email !== actor),
    deliveryEnabled,
    canExportRecipients: hasAdminCapability(access, "communications.export"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const env = getAppEnv();
  const db = env.DB;
  const actor = context.get(adminEmailContext);
  const access = context.get(adminAccessContext);

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
      inputFields: form.getAll("inputFields").map(String),
    });
    return data(result, { status: result.ok ? 200 : 400 });
  }
  if (intent === "delete-template") {
    const result = await deleteEmailTemplate(db, actor, Number(form.get("templateId") ?? ""));
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
    if (!hasAdminCapability(access, "communications.export")) {
      throw data("Access denied. Communication recipient export permission is required.", { status: 403 });
    }
    const recipients = await getCommunicationRecipients(db, {
      q: String(form.get("q") ?? ""),
      status: String(form.get("status") ?? ""),
      groupId: String(form.get("groupId") ?? ""),
    });
    await auditStatement(db, actor, "communication.recipient.export", null, {
      format: "csv",
      count: recipients.length,
    }, new Date().toISOString()).run();
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
  const { stats, recipients, groups, queue, unsubscribes, templates, templateReferenceCounts, approvers, deliveryEnabled, q, status, groupId, canExportRecipients } = loaderData;
  const activeTemplates = templates.filter((template) => template.is_active);
  const inactiveTemplates = templates.filter((template) => !template.is_active);
  const [selectedTemplateName, setSelectedTemplateName] = useState("");
  const [selectedRecipientEmail, setSelectedRecipientEmail] = useState("");
  const [composeFields, setComposeFields] = useState<Partial<Record<EmailTemplateInputField, string>>>({});
  const selectedTemplate = templates.find((template) => template.name === selectedTemplateName);
  const selectedRecipient = recipients.find((member) => member.email === selectedRecipientEmail);
  const previewRecipient = selectedRecipient ?? recipients[0];
  const preview = selectedTemplate
    ? renderEmailTemplate(selectedTemplate, {
        title: composeFields.title ?? "",
        content: composeFields.content ?? "",
        contribution_amount: composeFields.contribution_amount ?? "",
        contribution_date: composeFields.contribution_date ?? "",
        invoice_number: composeFields.invoice_number ?? "",
        due_date: composeFields.due_date ?? "",
        full_name: previewRecipient?.full_name ?? "Sample member",
        first_name: previewRecipient?.first_name ?? "Sample",
        preferred_name: previewRecipient?.preferred_name ?? previewRecipient?.full_name ?? "Sample member",
        household_name: previewRecipient?.household_name ?? "Sample household",
        email: previewRecipient?.email ?? "member@example.org",
        unsubscribe_url: "https://example.invalid/unsubscribe",
      })
    : null;
  const previewDocument = preview
    ? `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"></head><body>${preview.html}</body></html>`
    : "";
  const renderTemplateEditor = (template: (typeof templates)[number]) => {
    const referenceCount = templateReferenceCounts[template.id] ?? 0;
    return (
      <details key={template.id} className="group border-b border-slate-100 last:border-b-0">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-slate-50 group-open:bg-slate-100 sm:px-5">
          <span className="flex items-center gap-2">
            <PlusIcon className="size-4 text-slate-500 group-open:hidden" aria-hidden="true" />
            <MinusIcon className="hidden size-4 text-slate-700 group-open:block" aria-hidden="true" />
            <span className="font-medium text-slate-800 group-open:font-semibold group-open:text-slate-950">{template.name}</span>
          </span>
          <span className="text-xs text-slate-500 group-open:text-slate-700">
            {template.is_active ? "Active" : "Inactive"} · {referenceCount} queue {referenceCount === 1 ? "record" : "records"}
          </span>
        </summary>
        <Form method="post" className="grid gap-3 border-t border-slate-100 p-4 sm:p-5">
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
          <section className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Available merge fields</h3>
              <p className="mt-1 text-xs text-slate-600">
                Use these placeholders in the subject, HTML body, or plain-text body.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-700">Filled from the recipient</h4>
              <dl className="mt-1 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                <div><dt><code>{"{{preferred_name}}"}</code></dt><dd className="text-slate-600">Preferred name, or full name if none is set.</dd></div>
                <div><dt><code>{"{{first_name}}"}</code></dt><dd className="text-slate-600">Recipient's first name.</dd></div>
                <div><dt><code>{"{{full_name}}"}</code></dt><dd className="text-slate-600">Recipient's full name.</dd></div>
                <div><dt><code>{"{{household_name}}"}</code></dt><dd className="text-slate-600">Current household name, if assigned.</dd></div>
                <div><dt><code>{"{{email}}"}</code></dt><dd className="text-slate-600">Recipient's email address.</dd></div>
                <div><dt><code>{"{{unsubscribe_url}}"}</code></dt><dd className="text-slate-600">Personalized unsubscribe link.</dd></div>
              </dl>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-700">Entered when composing</h4>
              <dl className="mt-1 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                <div><dt><code>{"{{title}}"}</code></dt><dd className="text-slate-600">Message title.</dd></div>
                <div><dt><code>{"{{content}}"}</code></dt><dd className="text-slate-600">Message content.</dd></div>
                <div><dt><code>{"{{contribution_amount}}"}</code></dt><dd className="text-slate-600">Contribution amount.</dd></div>
                <div><dt><code>{"{{contribution_date}}"}</code></dt><dd className="text-slate-600">Contribution date.</dd></div>
                <div><dt><code>{"{{invoice_number}}"}</code></dt><dd className="text-slate-600">Invoice number.</dd></div>
                <div><dt><code>{"{{due_date}}"}</code></dt><dd className="text-slate-600">Invoice due date.</dd></div>
              </dl>
              <p className="mt-2 text-xs text-slate-600">
                Select the matching options below to show these fields in the composer.
              </p>
            </div>
          </section>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-slate-700">Inputs shown when composing</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {EMAIL_TEMPLATE_INPUT_FIELDS.map((field) => (
                <label key={field.key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="inputFields"
                    value={field.key}
                    defaultChecked={template.inputFields.includes(field.key)}
                    className="size-4 rounded border-slate-300"
                  />
                  {field.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Select fields used by this template. Member and household details are filled automatically.
            </p>
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="active" value="1" defaultChecked={template.is_active === 1} className="size-4 rounded border-slate-300" />
            Available for new messages
          </label>
          <button type="submit" className={buttonClass("secondary", "sm")}>Save template</button>
        </Form>
        {!template.is_active ? (
          <Form method="post" className="flex flex-wrap items-center gap-3 border-t border-slate-100 p-4 sm:p-5">
            <input type="hidden" name="intent" value="delete-template" />
            <input type="hidden" name="templateId" value={template.id} />
            <button
              type="submit"
              disabled={referenceCount > 0}
              onClick={(event) => {
                if (!window.confirm(`Permanently delete inactive template "${template.name}"? This cannot be undone.`)) {
                  event.preventDefault();
                }
              }}
              className={buttonClass("danger", "sm")}
              title={referenceCount > 0 ? "Templates with queue history cannot be deleted." : undefined}
            >
              <TrashIcon className="size-4" aria-hidden="true" />
              Delete template
            </button>
            {referenceCount > 0 ? (
              <p className="text-sm text-slate-600">
                Cannot delete: {referenceCount} queue {referenceCount === 1 ? "record refers" : "records refer"} to this template. Keep it inactive to preserve message history.
              </p>
            ) : null}
          </Form>
        ) : null}
      </details>
    );
  };
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
              <select
                name="templateName"
                required
                value={selectedTemplateName}
                onChange={(event) => {
                  setSelectedTemplateName(event.currentTarget.value);
                  setComposeFields({});
                }}
                className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value="">Select a template</option>
                {templates.filter((template) => template.is_active).map((template) => (
                  <option key={template.id} value={template.name}>{template.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Recipient (opted-in members matching the audience filters)
              <select
                name="recipientEmail"
                required
                value={selectedRecipientEmail}
                onChange={(event) => setSelectedRecipientEmail(event.currentTarget.value)}
                className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value="">Select a recipient</option>
                {recipients.map((member) => (
                  <option key={member.id} value={member.email ?? ""}>
                    {member.full_name} — {member.email}
                  </option>
                ))}
              </select>
            </label>
            {selectedTemplate ? (
              selectedTemplate.inputFields.length ? (
                <div className="grid gap-3">
                  {selectedTemplate.inputFields.map((key) => {
                    const field = EMAIL_TEMPLATE_INPUT_FIELDS.find((item) => item.key === key);
                    if (!field) return null;
                    if (field.type === "textarea") {
                      return (
                        <label key={field.key} className="text-sm font-medium text-slate-700">
                          {field.label}
                          <textarea
                            name={COMPOSER_FIELD_NAMES[field.key]}
                            rows={5}
                            maxLength={field.maxLength}
                            value={composeFields[field.key] ?? ""}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setComposeFields((current) => ({ ...current, [field.key]: value }));
                            }}
                            className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                          />
                        </label>
                      );
                    }
                    return (
                      <TextField
                        key={field.key}
                        name={COMPOSER_FIELD_NAMES[field.key]}
                        label={field.label}
                        type={field.type}
                        maxLength={field.maxLength}
                        value={composeFields[field.key] ?? ""}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setComposeFields((current) => ({ ...current, [field.key]: value }));
                        }}
                      />
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  This template has no message inputs. Member and household details are filled automatically.
                </p>
              )
            ) : (
              <p className="text-sm text-slate-500">Select a template to see its inputs and preview.</p>
            )}
            {selectedTemplate && preview ? (
              <section className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3" aria-label="Rendered email preview">
                <h3 className="text-sm font-semibold text-slate-800">Email preview</h3>
                <p className="text-sm text-slate-700"><span className="font-medium">Subject:</span> {preview.subject || "(empty)"}</p>
                <p className="text-xs text-slate-500">
                  Previewing as {previewRecipient?.full_name ?? "a sample member"}.
                </p>
                <iframe
                  title="Rendered email preview"
                  sandbox=""
                  srcDoc={previewDocument}
                  className="h-80 w-full rounded border border-slate-200 bg-white"
                />
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-slate-600">Plain-text version</summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-3 text-xs text-slate-700">{preview.text || "(empty)"}</pre>
                </details>
              </section>
            ) : null}
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
          actions={canExportRecipients ? (
            <Form method="post">
              <input type="hidden" name="intent" value="export-recipients" />
              <input type="hidden" name="q" value={q} />
              <input type="hidden" name="status" value={status} />
              <input type="hidden" name="groupId" value={groupId} />
              <button type="submit" className={buttonClass("secondary", "sm")}>
                <ArrowDownTrayIcon className="size-4" aria-hidden="true" /> Export CSV
              </button>
            </Form>
          ) : null}
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
          <p className="px-4 pt-4 text-xs text-slate-500 sm:px-5">
            Expand a template to edit its message, composer inputs, or availability.
          </p>
          <div className="divide-y divide-slate-100">
            {activeTemplates.map(renderTemplateEditor)}
            {inactiveTemplates.length ? (
              <details className="border-t border-slate-200">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:px-5">
                  Inactive templates ({inactiveTemplates.length})
                </summary>
                <div className="divide-y divide-slate-100">
                  {inactiveTemplates.map(renderTemplateEditor)}
                </div>
              </details>
            ) : null}
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
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium text-slate-700">Inputs shown when composing</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {EMAIL_TEMPLATE_INPUT_FIELDS.map((field) => (
                    <label key={field.key} className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="inputFields" value={field.key} className="size-4 rounded border-slate-300" />
                      {field.label}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  Select fields used by this template. Member and household details are filled automatically.
                </p>
              </fieldset>
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
