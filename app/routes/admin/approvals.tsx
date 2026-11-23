import { Form, data } from "react-router";
import { BellAlertIcon, CheckCircleIcon, ClipboardDocumentCheckIcon } from "@heroicons/react/24/outline";

import type { Route } from "./+types/approvals";
import { EmptyState, Notice, PageHeader, Panel } from "~/components/admin";
import { TextField } from "~/components/forms";
import { buttonClass } from "~/components/ui";
import { adminAccessContext, adminEmailContext } from "~/lib/admin-context";
import { decideApproval, markNotificationsRead } from "~/lib/approvals.server";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime } from "~/lib/format";
import { hasAdminCapability, hasAdminModule } from "~/lib/admin-access";

export function meta() {
  return [{ title: "Approvals — ORBIT" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const db = getAppEnv().DB;
  const actor = context.get(adminEmailContext);
  const access = context.get(adminAccessContext);
  const [approvals, history, notifications] = await Promise.all([
    db.prepare(
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
       WHERE a.status = 'pending' AND a.assigned_to = ?
       ORDER BY a.created_at`,
    ).bind(actor).all<{
      id: string;
      resource_type: "document" | "communication";
      requested_by: string;
      created_at: string;
      title: string | null;
      recipient: string | null;
      batch_recipients: string | null;
      document_content: string | null;
      message_data: string | null;
      comments: string | null;
    }>().then((result) => result.results.map((item) => {
      const emailData = item.message_data
        ? JSON.parse(item.message_data) as { rendered?: { subject?: unknown; text?: unknown; html?: unknown } }
        : {};
      const rendered = emailData.rendered;
      const preview = item.document_content ??
        (typeof rendered?.text === "string" && rendered.text
          ? rendered.text
          : typeof rendered?.html === "string"
            ? rendered.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
            : "");
      return {
        ...item,
        title: typeof rendered?.subject === "string" ? rendered.subject : item.title,
        preview,
      };
    })),
    db.prepare(
      `SELECT a.id, a.resource_type, a.status, a.requested_by, a.decision_by, a.decision_at,
              (SELECT GROUP_CONCAT(author || ': ' || body, char(10))
               FROM approval_comments c WHERE c.request_id = a.id) AS comments
       FROM approval_requests a
       WHERE a.status <> 'pending' AND (a.requested_by = ? OR a.assigned_to = ?)
       ORDER BY a.decision_at DESC LIMIT 25`,
    ).bind(actor, actor).all<{
      id: string;
      resource_type: "document" | "communication";
      status: string;
      requested_by: string;
      decision_by: string | null;
      decision_at: string | null;
      comments: string | null;
    }>(),
    db.prepare(
      `SELECT id, message, href, created_at FROM admin_notifications
       WHERE recipient = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT 20`,
    ).bind(actor).all<{ id: number; message: string; href: string; created_at: string }>(),
  ]);
  return {
    approvals,
    history: history.results,
    notifications: notifications.results,
    canViewDocuments: hasAdminModule(access, "documents"),
    canViewCommunications: hasAdminModule(access, "communications"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const actor = context.get(adminEmailContext);
  const access = context.get(adminAccessContext);
  const db = getAppEnv().DB;
  if (form.get("intent") === "mark-read") {
    await markNotificationsRead(db, actor);
    return data({ ok: true, message: "Notifications marked as read." });
  }
  if (form.get("intent") !== "decide") return data({ ok: false, message: "Unknown action." }, { status: 400 });
  if (!hasAdminCapability(access, "approvals.decide")) {
    throw data("Access denied. Approval decision permission is required.", { status: 403 });
  }
  const decision = String(form.get("decision") ?? "");
  if (decision !== "approved" && decision !== "rejected") {
    return data({ ok: false, message: "Choose approve or reject." }, { status: 400 });
  }
  const result = await decideApproval(
    db,
    String(form.get("requestId") ?? ""),
    actor,
    decision,
    String(form.get("comment") ?? ""),
  );
  return data(result, { status: result.ok ? 200 : 400 });
}

export default function Approvals({ loaderData, actionData }: Route.ComponentProps) {
  const { approvals, history, notifications } = loaderData;
  return (
    <div>
      <PageHeader eyebrow="Workflow" title="Approvals" description="Review documents and communications assigned to you." />
      <Notice result={actionData} className="mb-5" />
      {notifications.length > 0 && (
        <Panel title="Notifications" icon={BellAlertIcon} className="mb-6">
          <ul className="divide-y divide-slate-100">
            {notifications.map((item) => (
              <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <a className="text-brand hover:underline" href={item.href}>{item.message}</a>
                <time className="text-xs text-slate-500" dateTime={item.created_at}>{formatDateTime(item.created_at)}</time>
              </li>
            ))}
          </ul>
          <Form method="post" className="mt-4">
            <input type="hidden" name="intent" value="mark-read" />
            <button type="submit" className={buttonClass("secondary", "sm")}>Mark notifications read</button>
          </Form>
        </Panel>
      )}
      <Panel title="Recent decisions" icon={CheckCircleIcon} className="mt-6" flush>
        {history.length ? (
          <ul className="divide-y divide-slate-100">
            {history.map((item) => (
              <li key={item.id} className="px-4 py-3 text-sm sm:px-5">
                <p className="font-medium text-slate-900 capitalize">{item.resource_type} — {item.status}</p>
                <p className="text-xs text-slate-500">
                  Requested by {item.requested_by}{item.decision_by ? ` · reviewed by ${item.decision_by}` : ""}
                  {item.decision_at ? ` · ${formatDateTime(item.decision_at)}` : ""}
                </p>
                {item.comments && <p className="mt-2 whitespace-pre-wrap text-slate-600">{item.comments}</p>}
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={ClipboardDocumentCheckIcon}>No recent decisions.</EmptyState>}
      </Panel>
      <Panel title={<>Assigned to me <span className="text-slate-400 tabular-nums">({approvals.length})</span></>} icon={ClipboardDocumentCheckIcon} flush>
        {approvals.length ? (
          <ul className="divide-y divide-slate-100">
            {approvals.map((item) => (
              <li key={item.id} className="space-y-3 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{item.resource_type}</p>
                    <h2 className="font-semibold text-slate-900">{item.title || "Approval request"}</h2>
                    <p className="text-sm text-slate-600">{item.recipient || ""}</p>
                    <p className="text-xs text-slate-500">Requested by {item.requested_by} · {formatDateTime(item.created_at)}</p>
                  </div>
                  {item.resource_type === "document" && loaderData.canViewDocuments ? (
                    <a className="text-sm text-brand hover:underline" href="/admin/documents">View item</a>
                  ) : item.resource_type === "communication" && loaderData.canViewCommunications ? (
                    <a className="text-sm text-brand hover:underline" href="/admin/communications">View item</a>
                  ) : null}
                </div>
                {item.batch_recipients && (
                  <details className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <summary className="cursor-pointer font-medium">Review batch recipients</summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5">{item.batch_recipients}</pre>
                  </details>
                )}
                {item.preview && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">{item.preview}</pre>}
                {item.comments && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{item.comments}</p>}
                <Form method="post" className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                  <input type="hidden" name="intent" value="decide" />
                  <input type="hidden" name="requestId" value={item.id} />
                  <TextField name="comment" label="Decision note (required to reject)" maxLength={2000} />
                  <button name="decision" value="approved" type="submit" className={buttonClass("primary", "md")}>
                    <CheckCircleIcon className="size-4" aria-hidden="true" /> Approve
                  </button>
                  <button name="decision" value="rejected" type="submit" className={buttonClass("secondary", "md")}>
                    Reject
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={ClipboardDocumentCheckIcon}>No approval requests are assigned to you.</EmptyState>}
      </Panel>
    </div>
  );
}
