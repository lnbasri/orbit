import { Form, data } from "react-router";
import { DocumentTextIcon, PlusIcon } from "@heroicons/react/24/outline";

import type { Route } from "./+types/documents";
import { EmptyState, Notice, PageHeader, Panel } from "~/components/admin";
import { TextField } from "~/components/forms";
import { buttonClass } from "~/components/ui";
import { adminEmailContext } from "~/lib/admin-context";
import { listAdmins } from "~/lib/admins.server";
import {
  generateDocument,
  listDocumentTemplates,
  listGeneratedDocuments,
  previewDocument,
  saveDocumentTemplate,
  setDocumentTemplateActive,
} from "~/lib/documents.server";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime } from "~/lib/format";

export function meta() {
  return [{ title: "Documents — ORBIT" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = getAppEnv();
  const actor = context.get(adminEmailContext);
  const url = new URL(request.url);
  const [templates, admins, members, households, documents] = await Promise.all([
    listDocumentTemplates(env.DB),
    listAdmins(env.DB),
    env.DB.prepare(
      "SELECT id, full_name FROM members WHERE archived_at IS NULL AND status <> 'deceased' ORDER BY full_name",
    ).all<{ id: string; full_name: string }>(),
    env.DB.prepare("SELECT id, name FROM households WHERE status = 'active' ORDER BY name")
      .all<{ id: string; name: string }>(),
    listGeneratedDocuments(env.DB),
  ]);
  const previewTemplateId = url.searchParams.get("template") ?? "";
  const previewTarget = url.searchParams.get("target") ?? "";
  const [targetType, targetId] = previewTarget.split(":", 2);
  let preview: { title: string; body: string } | null = null;
  if (
    previewTemplateId &&
    targetId &&
    (targetType === "member" || targetType === "household")
  ) {
    preview = await previewDocument(
      env.DB,
      previewTemplateId,
      targetType === "member" ? { memberId: targetId } : { householdId: targetId },
    );
  }
  return {
    templates,
    approvers: admins.filter((admin) => admin.active && admin.email !== actor),
    members: members.results,
    households: households.results,
    documents,
    preview,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const env = getAppEnv();
  const actor = context.get(adminEmailContext);
  const intent = String(form.get("intent") ?? "");

  if (intent === "save-template") {
    const result = await saveDocumentTemplate(env.DB, actor, {
      id: String(form.get("templateId") ?? "") || undefined,
      name: String(form.get("name") ?? ""),
      title: String(form.get("titleTemplate") ?? ""),
      body: String(form.get("bodyTemplate") ?? ""),
    });
    return data(result, { status: result.ok ? 200 : 400 });
  }
  if (intent === "toggle-template") {
    const active = String(form.get("active") ?? "") === "1";
    const result = await setDocumentTemplateActive(env.DB, actor, String(form.get("templateId") ?? ""), active);
    return data(result, { status: result.ok ? 200 : 400 });
  }
  if (intent === "generate") {
    const target = String(form.get("target") ?? "");
    const [targetType, targetId] = target.split(":", 2);
    const result = await generateDocument(
      env.DB,
      env.DOCUMENTS,
      {
        templateId: String(form.get("templateId") ?? ""),
        memberId: targetType === "member" ? targetId : undefined,
        householdId: targetType === "household" ? targetId : undefined,
        customFields: {
          contribution_amount: String(form.get("contributionAmount") ?? ""),
          contribution_date: String(form.get("contributionDate") ?? ""),
        },
        requestedBy: actor,
        assignedTo: String(form.get("assignedTo") ?? ""),
      },
    );
    return data(result, { status: result.ok ? 200 : 400 });
  }
  return data({ ok: false, message: "Unknown action." }, { status: 400 });
}

export default function Documents({ loaderData, actionData }: Route.ComponentProps) {
  const { templates, approvers, members, households, documents, preview } = loaderData;
  return (
    <div>
      <PageHeader eyebrow="Documents" title="Document automation" description="Maintain reusable templates, generate versioned PDFs, and route them for approval." />
      <Notice result={actionData} className="mb-5" />

      <Panel title="Generate a PDF" icon={DocumentTextIcon}>
        <Form method="post" className="grid gap-3 md:grid-cols-2">
          <input type="hidden" name="intent" value="generate" />
          <label className="text-sm font-medium text-slate-700">
            Template
            <select name="templateId" required className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
              <option value="">Select a template</option>
              {templates.filter((template) => template.is_active).map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Member or household
            <select name="target" required className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
              <option value="">Select a person or household</option>
              <optgroup label="Members">
                {members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.full_name}</option>)}
              </optgroup>
              <optgroup label="Households">
                {households.map((household) => <option key={household.id} value={`household:${household.id}`}>{household.name}</option>)}
              </optgroup>
            </select>
          </label>
          <TextField name="contributionAmount" label="Contribution amount (optional)" maxLength={80} />
          <TextField name="contributionDate" label="Contribution date (optional)" type="date" />
          <label className="text-sm font-medium text-slate-700 md:col-span-2">
            Approver
            <select name="assignedTo" required className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
              <option value="">Select a different administrator</option>
              {approvers.map((admin) => <option key={admin.email} value={admin.email}>{admin.name || admin.email}</option>)}
            </select>
          </label>
          <button type="submit" disabled={!templates.some((template) => template.is_active) || !approvers.length} className={buttonClass("primary", "md")}>
            Generate and request approval
          </button>
        </Form>
        {!approvers.length && <p className="mt-3 text-sm text-amber-800">Add another active administrator before creating an approval request.</p>}
      </Panel>

      <Panel title="Preview a template" icon={DocumentTextIcon} className="mt-6">
        <Form method="get" className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="text-sm font-medium text-slate-700">
            Template
            <select name="template" required className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
              <option value="">Select a template</option>
              {templates.filter((template) => template.is_active).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Member or household
            <select name="target" required className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
              <option value="">Select a person or household</option>
              <optgroup label="Members">{members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.full_name}</option>)}</optgroup>
              <optgroup label="Households">{households.map((household) => <option key={household.id} value={`household:${household.id}`}>{household.name}</option>)}</optgroup>
            </select>
          </label>
          <button type="submit" className={buttonClass("secondary", "md")}>Preview</button>
        </Form>
        {preview && (
          <article className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="font-semibold text-slate-900">{preview.title}</h2>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">{preview.body}</pre>
          </article>
        )}
      </Panel>

      <Panel title="Document templates" icon={PlusIcon} className="mt-6" flush>
        <div className="divide-y divide-slate-100">
          {templates.map((template) => (
            <div key={template.id} className="px-4 py-4 sm:px-5">
              <Form method="post" className="grid gap-3">
                <input type="hidden" name="intent" value="save-template" />
                <input type="hidden" name="templateId" value={template.id} />
                <TextField name="name" label="Template name" required maxLength={120} defaultValue={template.name} />
                <TextField name="titleTemplate" label="Document title" required maxLength={200} defaultValue={template.title_template} />
                <label className="text-sm font-medium text-slate-700">
                  Body template
                  <textarea name="bodyTemplate" required rows={6} maxLength={12000} defaultValue={template.body_template} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
                </label>
                <p className="text-xs text-slate-500">Merge fields use double braces, for example {"{{full_name}}"}, {"{{household_name}}"}, {"{{total_members}}"}, {"{{contribution_amount}}"}, and {"{{generated_at}}"}.</p>
                <button type="submit" className={buttonClass("secondary", "sm")}>Save template</button>
              </Form>
              <Form method="post" className="mt-2">
                <input type="hidden" name="intent" value="toggle-template" />
                <input type="hidden" name="templateId" value={template.id} />
                <input type="hidden" name="active" value={template.is_active ? "0" : "1"} />
                <button type="submit" className={buttonClass("secondary", "sm")}>{template.is_active ? "Deactivate" : "Activate"}</button>
              </Form>
            </div>
          ))}
          {!templates.length && <EmptyState icon={DocumentTextIcon}>No document templates yet.</EmptyState>}
        </div>
        <div className="border-t border-slate-100 p-4 sm:p-5">
          <h2 className="mb-3 font-semibold text-slate-900">Add a template</h2>
          <Form method="post" className="grid gap-3">
            <input type="hidden" name="intent" value="save-template" />
            <TextField name="name" label="Template name" required maxLength={120} />
            <TextField name="titleTemplate" label="Document title" required maxLength={200} />
            <label className="text-sm font-medium text-slate-700">
              Body template
              <textarea name="bodyTemplate" required rows={6} maxLength={12000} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
            </label>
            <button type="submit" className={buttonClass("primary", "md")}>Add template</button>
          </Form>
        </div>
      </Panel>

      <Panel title={<>Generated PDFs <span className="text-slate-400 tabular-nums">({documents.length})</span></>} icon={DocumentTextIcon} className="mt-6" flush>
        {documents.length ? (
          <ul className="divide-y divide-slate-100">
            {documents.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm sm:px-5">
                <div>
                  <p className="font-medium text-slate-900">{document.title}</p>
                  <p className="text-slate-600">{document.subject_name} · {document.template_name} · v{document.version}</p>
                  <p className="text-xs capitalize text-slate-500">{document.status.replaceAll("_", " ")} · {formatDateTime(document.created_at)}</p>
                </div>
                {document.status === "approved" && <a className="text-brand hover:underline" href={`/admin/documents/${document.id}/download`}>Download PDF</a>}
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={DocumentTextIcon}>No PDFs have been generated.</EmptyState>}
      </Panel>
    </div>
  );
}
