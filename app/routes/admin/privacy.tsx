import { data, Form } from "react-router";
import {
  EmptyState,
  Notice,
  PageHeader,
  Panel,
} from "~/components/admin";
import { buttonClass } from "~/components/ui";
import type { Route } from "./+types/privacy";
import { adminAccessContext, adminEmailContext } from "~/lib/admin-context";
import { hasAdminCapability } from "~/lib/admin-access";
import { audit } from "~/lib/db.server";
import { getAppEnv } from "~/lib/env.server";
import {
  buildPrivacyExport,
  createPrivacyRequest,
  listPrivacyRequests,
  updatePrivacyRequest,
} from "~/lib/privacy.server";
import {
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
  type PrivacyRequestRow,
} from "~/lib/privacy-constants";

const REQUEST_TYPE_LABELS: Record<(typeof PRIVACY_REQUEST_TYPES)[number], string> = {
  access: "Access",
  rectification: "Rectification",
  erasure: "Erasure",
  restriction: "Restriction",
  objection: "Objection",
  portability: "Portability",
  other: "Other",
};

const REQUEST_STATUS_LABELS: Record<(typeof PRIVACY_REQUEST_STATUSES)[number], string> = {
  received: "Received",
  verifying: "Verifying identity",
  in_progress: "In progress",
  completed: "Completed",
  declined: "Declined",
};

const INPUT_CLASS =
  "mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15";

export function meta() {
  return [{ title: "Privacy requests — ORBIT" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = getAppEnv().DB;
  const access = context.get(adminAccessContext);
  const url = new URL(request.url);
  const memberId = url.searchParams.get("memberId") ?? "";
  const [selectedMember, members] = await Promise.all([
    memberId
      ? db.prepare("SELECT id, full_name FROM members WHERE id = ?")
          .bind(memberId)
          .first<{ id: string; full_name: string }>()
      : Promise.resolve(null),
    db.prepare("SELECT id, full_name FROM members WHERE archived_at IS NULL ORDER BY full_name")
      .all<{ id: string; full_name: string }>(),
  ]);
  return {
    requests: await listPrivacyRequests(db),
    selectedMember,
    members: members.results,
    today: new Date().toISOString().slice(0, 10),
    canExport: hasAdminCapability(access, "privacy.export"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const env = getAppEnv();
  const actor = context.get(adminEmailContext);
  const access = context.get(adminAccessContext);

  if (intent === "create") {
    const result = await createPrivacyRequest(
      env.DB,
      actor,
      String(form.get("memberId") ?? ""),
      {
        requestType: String(form.get("requestType") ?? ""),
        receivedOn: String(form.get("receivedOn") ?? ""),
        dueOn: String(form.get("dueOn") ?? ""),
        internalNotes: String(form.get("internalNotes") ?? ""),
      },
    );
    return data(result, { status: result.ok ? 200 : 400 });
  }

  if (intent === "update") {
    const result = await updatePrivacyRequest(
      env.DB,
      actor,
      String(form.get("requestId") ?? ""),
      {
        status: String(form.get("status") ?? ""),
        verificationStatus: String(form.get("verificationStatus") ?? ""),
        dueOn: String(form.get("dueOn") ?? ""),
        internalNotes: String(form.get("internalNotes") ?? ""),
      },
    );
    return data(result, { status: result.ok ? 200 : 400 });
  }

  if (intent === "export") {
    if (!hasAdminCapability(access, "privacy.export")) {
      throw data("Access denied. Personal-data export permission is required.", { status: 403 });
    }
    const requestId = String(form.get("requestId") ?? "");
    const archive = await buildPrivacyExport(env.DB, env.DOCUMENTS, requestId);
    await audit(env.DB, actor, "privacy.request.export", requestId, { format: "zip" });
    const body = new ArrayBuffer(archive.byteLength);
    new Uint8Array(body).set(archive);
    return new Response(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="orbit-privacy-export-${requestId}.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return data({ ok: false, message: "Unknown action." }, { status: 400 });
}

export default function PrivacyRequests({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const result = actionData as { ok: boolean; message: string } | undefined;
  const { requests, selectedMember, members, today, canExport } = loaderData;

  return (
    <div>
      <PageHeader
        eyebrow="Data protection"
        title="Privacy requests"
        description="Record and track requests received by the organization. Verify identity before preparing an export."
      />
      <Notice result={result} className="mb-5" />

      <Panel title={selectedMember ? `Record a request for ${selectedMember.full_name}` : "Record a request"} className="mb-6">
          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="create" />
            {selectedMember ? (
              <input type="hidden" name="memberId" value={selectedMember.id} />
            ) : (
              <label className="block text-sm font-medium text-slate-700">
                Member
                <select name="memberId" required className={INPUT_CLASS} defaultValue="">
                  <option value="">Select a member</option>
                  {members.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}
                </select>
              </label>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">
                Request type
                <select name="requestType" defaultValue="access" className={INPUT_CLASS}>
                  {PRIVACY_REQUEST_TYPES.map((type) => (
                    <option key={type} value={type}>{REQUEST_TYPE_LABELS[type]}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-slate-700">
                Received on
                <input name="receivedOn" type="date" required defaultValue={today} className={INPUT_CLASS} />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Target response date
                <input name="dueOn" type="date" className={INPUT_CLASS} />
              </label>
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                Internal case notes
                <textarea
                  name="internalNotes"
                  rows={2}
                  maxLength={2000}
                  className={INPUT_CLASS}
                  placeholder="Record only information needed to manage the request."
                />
              </label>
            </div>
            <p className="text-xs text-slate-500">
              Set the target date according to the organization&apos;s approved procedure.
              Avoid recording unnecessary personal or sensitive details in notes.
            </p>
            <button type="submit" className={buttonClass("primary", "md")}>Record request</button>
          </Form>
      </Panel>

      <Panel title={`Request register (${requests.length})`}>
        {requests.length ? (
          <ul className="space-y-4">
            {requests.map((item) => (
              <li key={item.id} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-900">
                      {item.member_name ?? "Member record no longer linked"}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {REQUEST_TYPE_LABELS[item.request_type]} request · received {item.received_on}
                      {item.due_on ? ` · target ${item.due_on}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Case {item.id.slice(0, 8)} · updated {item.updated_at}
                    </p>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                    {REQUEST_STATUS_LABELS[item.status]}
                  </span>
                </div>

                {item.internal_notes ? (
                  <p className="mb-4 whitespace-pre-wrap text-sm text-slate-600">{item.internal_notes}</p>
                ) : null}

                <div className="flex flex-wrap items-end gap-3">
                  <Form method="post" className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <input type="hidden" name="intent" value="update" />
                    <input type="hidden" name="requestId" value={item.id} />
                    <label className="text-xs font-medium text-slate-600">
                      Status
                      <select name="status" defaultValue={item.status} className={INPUT_CLASS}>
                        {PRIVACY_REQUEST_STATUSES.map((status) => (
                          <option key={status} value={status}>{REQUEST_STATUS_LABELS[status]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Identity verification
                      <select name="verificationStatus" defaultValue={item.verification_status} className={INPUT_CLASS}>
                        <option value="pending">Pending</option>
                        <option value="verified">Verified</option>
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Target response date
                      <input name="dueOn" type="date" defaultValue={item.due_on ?? ""} className={INPUT_CLASS} />
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Internal notes
                      <input
                        name="internalNotes"
                        maxLength={2000}
                        defaultValue={item.internal_notes}
                        className={INPUT_CLASS}
                      />
                    </label>
                    <button type="submit" className={buttonClass("secondary", "sm", "sm:col-span-2 xl:col-span-4")}>
                      Save case
                    </button>
                  </Form>
                  {canExport && canExportRequest(item) ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="export" />
                      <input type="hidden" name="requestId" value={item.id} />
                      <button type="submit" className={buttonClass("primary", "sm")}>
                        Prepare data export
                      </button>
                    </Form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No privacy requests have been recorded.</EmptyState>
        )}
      </Panel>
    </div>
  );
}

function canExportRequest(request: PrivacyRequestRow) {
  return request.verification_status === "verified" &&
    (request.request_type === "access" || request.request_type === "portability") &&
    request.member_id !== null &&
    request.status !== "declined";
}
