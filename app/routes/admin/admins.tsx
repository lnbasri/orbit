import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import type { Route } from "./+types/admins";
import {
  EnvelopeIcon,
  InformationCircleIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { Notice, PageHeader, Panel } from "~/components/admin";
import { TextField } from "~/components/forms";
import { Spinner, buttonClass } from "~/components/ui";
import { adminEmailContext } from "~/lib/admin-context";
import { addAdmin, listAdmins, removeAdmin, setAdminRole } from "~/lib/admins.server";
import {
  createAdminDepartment,
  listAdminAccessAssignments,
  setAdminAccess,
} from "~/lib/admin-access.server";
import { ADMIN_ACCESS_ROLES, ADMIN_CAPABILITY_OPTIONS } from "~/lib/admin-access";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime } from "~/lib/format";

export function meta() {
  return [{ title: "Manage access — ORBIT" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const db = getAppEnv().DB;
  const [admins, assignments] = await Promise.all([
    listAdmins(db),
    listAdminAccessAssignments(db),
  ]);
  return {
    admins: admins.map((admin) => ({
      ...admin,
      accessRoles: assignments.roles[admin.email] ?? [],
      capabilities: assignments.capabilities[admin.email] ?? [],
      departmentIds: assignments.departmentsByEmail[admin.email] ?? [],
    })),
    departments: assignments.departments,
    me: context.get(adminEmailContext),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const actor = context.get(adminEmailContext);
  const db = getAppEnv().DB;
  if (intent === "add-admin") {
    const role = String(form.get("role") ?? "ADMIN");
    if (role !== "SUPER_ADMIN" && role !== "ADMIN") return { ok: false, message: "Unknown administrator role." };
    return addAdmin(
      db,
      actor,
      String(form.get("email") ?? ""),
      String(form.get("name") ?? ""),
      role,
      new Date(),
      form.getAll("roles").map(String),
      form.getAll("capabilities").map(String),
      form.getAll("departments").map(String),
    );
  }
  if (intent === "remove-admin") {
    return removeAdmin(db, actor, String(form.get("email") ?? ""));
  }
  if (intent === "set-admin-role") {
    const role = String(form.get("role") ?? "");
    if (role !== "SUPER_ADMIN" && role !== "ADMIN") return { ok: false, message: "Unknown administrator role." };
    return setAdminRole(db, actor, String(form.get("email") ?? ""), role);
  }
  if (intent === "set-access") {
    return setAdminAccess(
      db,
      actor,
      String(form.get("email") ?? ""),
      form.getAll("roles").map(String),
      form.getAll("capabilities").map(String),
      form.getAll("departments").map(String),
    );
  }
  if (intent === "create-department") {
    return createAdminDepartment(db, actor, String(form.get("name") ?? ""));
  }
  return { ok: false, message: "Unknown action." };
}

export default function Admins({ loaderData }: Route.ComponentProps) {
  const { admins, departments, me } = loaderData;
  const legacyCount = admins.filter((admin) => admin.role === "ADMIN" && admin.accessRoles.length === 0).length;
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const formRef = useRef<HTMLFormElement>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) formRef.current?.reset();
  }, [fetcher.data]);

  return (
    <div>
      <PageHeader
        eyebrow="Access"
        title={
          <>
            Manage administrators <span className="text-slate-400 tabular-nums">({admins.length})</span>
          </>
        }
        description="Assign multiple permission bundles and organisational departments. Department membership is descriptive; roles grant app access."
      />

      <div className="space-y-6">
        {legacyCount > 0 ? (
          <div className="border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {legacyCount} existing {legacyCount === 1 ? "administrator has" : "administrators have"} legacy broad access.
            Assign at least one role to each to restrict access to selected areas.
          </div>
        ) : null}

        <Panel title="Add administrator" icon={UserPlusIcon}>
          <fetcher.Form ref={formRef} method="post" className="grid gap-4">
            <input type="hidden" name="intent" value="add-admin" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TextField
                name="email"
                type="email"
                label="Email"
                icon={EnvelopeIcon}
                required
                autoComplete="off"
                placeholder="name@example.org"
              />
              <TextField
                name="name"
                label="Name (optional)"
                icon={UserIcon}
                maxLength={120}
                autoComplete="off"
                placeholder="Administrator"
              />
              <label className="text-sm font-medium text-slate-700">
                Account type
                <select name="role" defaultValue="ADMIN" className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                  <option value="ADMIN">Role-based administrator</option>
                  <option value="SUPER_ADMIN">Super administrator</option>
                </select>
              </label>
            </div>
            <fieldset>
              <legend className="text-sm font-semibold text-slate-700">Permission bundles</legend>
              <p className="mb-2 text-xs text-slate-500">Choose at least one for a role-based administrator. Bundles can be combined.</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ADMIN_ACCESS_ROLES.map((role) => (
                  <label key={role.id} className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
                    <input type="checkbox" name="roles" value={role.id} className="mt-1" />
                    <span><strong className="block text-slate-800">{role.label}</strong><span className="text-xs text-slate-500">{role.description}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-semibold text-slate-700">Sensitive permissions</legend>
              <p className="mb-2 text-xs text-slate-500">Exports, imports, and approved PDF downloads are separate from module access.</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ADMIN_CAPABILITY_OPTIONS.map((capability) => (
                  <label key={capability.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="capabilities" value={capability.id} />
                    {capability.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {departments.length ? (
              <fieldset>
                <legend className="text-sm font-semibold text-slate-700">Departments/commissions</legend>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                  {departments.map((department) => (
                    <label key={department.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="departments" value={department.id} />
                      {department.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <div>
              <button type="submit" disabled={busy} className={buttonClass("primary", "md")}>
              {busy ? <Spinner /> : <UserPlusIcon className="size-4" aria-hidden="true" />}
              {busy ? "Saving…" : "Add"}
              </button>
            </div>
          </fetcher.Form>
          <Notice result={fetcher.data} className="mt-4" />
          <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
            <InformationCircleIcon className="size-4 shrink-0" aria-hidden="true" />
            Administrators sign in with a one-time email code or Google (when enabled). Removing an administrator ends their sessions immediately. Super administrators always retain full access.
          </p>
        </Panel>

        <Panel title="Administrator list" icon={ShieldCheckIcon} flush>
          <ul className="divide-y divide-slate-100">
            {admins.map((a) => (
              <li key={a.email} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 text-sm font-semibold text-brand uppercase"
                  aria-hidden="true"
                >
                  {(a.name || a.email).slice(0, 1)}
                </span>
                <div className="min-w-[200px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold break-all text-slate-900">{a.email}</span>
                    {a.email === me ? (
                      <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand ring-1 ring-brand-200 ring-inset">
                        You
                      </span>
                    ) : null}
                  </div>
                  {a.name ? <div className="text-sm text-slate-600">{a.name}</div> : null}
                  <div className="mt-1 text-xs font-semibold text-brand">
                    {a.role === "SUPER_ADMIN" ? "Super administrator" : "Administrator"}
                  </div>
                  {a.role === "ADMIN" && a.accessRoles.length === 0 ? (
                    <div className="mt-1 text-xs font-semibold text-amber-800">Legacy broad access — no permission bundle assigned</div>
                  ) : a.role === "ADMIN" ? (
                    <div className="mt-1 text-xs text-slate-600">
                      {a.accessRoles.map((role) => ADMIN_ACCESS_ROLES.find((item) => item.id === role)?.label ?? role).join(", ")}
                    </div>
                  ) : null}
                  {a.departmentIds.length ? (
                    <div className="mt-1 text-xs text-slate-500">
                      Departments: {a.departmentIds.map((id) => departments.find((department) => department.id === id)?.name ?? id).join(", ")}
                    </div>
                  ) : null}
                  <div className="mt-0.5 text-xs text-slate-500">
                    Added {formatDateTime(a.added_at)} by {a.added_by} · last login{" "}
                    {a.last_login_at ? formatDateTime(a.last_login_at) : "never"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {a.email === me ? null : (
                    <>
                    <fetcher.Form method="post" className="flex items-center gap-2">
                      <input type="hidden" name="intent" value="set-admin-role" />
                      <input type="hidden" name="email" value={a.email} />
                      <label className="sr-only" htmlFor={`role-${a.email}`}>Role for {a.email}</label>
                      <select
                        id={`role-${a.email}`}
                        name="role"
                        defaultValue={a.role}
                        onChange={(event) => event.currentTarget.form?.requestSubmit()}
                        className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700"
                      >
                        <option value="ADMIN">Administrator</option>
                        <option value="SUPER_ADMIN">Super administrator</option>
                      </select>
                    </fetcher.Form>
                    <fetcher.Form method="post" className="flex items-center gap-2">
                      <input type="hidden" name="intent" value="remove-admin" />
                      <input type="hidden" name="email" value={a.email} />
                      <button
                        type="submit"
                        onClick={(event) => {
                          if (!window.confirm(`Remove ${a.email} from ORBIT administrators?`)) event.preventDefault();
                        }}
                        disabled={busy}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                      >
                        <TrashIcon className="size-4" aria-hidden="true" />
                        Remove
                      </button>
                    </fetcher.Form>
                    </>
                  )}
                </div>
                <fetcher.Form method="post" className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                  <input type="hidden" name="intent" value="set-access" />
                  <input type="hidden" name="email" value={a.email} />
                  <fieldset>
                    <legend className="text-sm font-semibold text-slate-700">
                      Permission bundles{a.role === "SUPER_ADMIN" ? " (full access overrides these)" : ""}
                    </legend>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {ADMIN_ACCESS_ROLES.map((role) => (
                        <label key={role.id} className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
                          <input type="checkbox" name="roles" value={role.id} defaultChecked={a.accessRoles.includes(role.id)} className="mt-1" />
                          <span><strong className="block text-slate-800">{role.label}</strong><span className="text-xs text-slate-500">{role.description}</span></span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="text-sm font-semibold text-slate-700">Sensitive permissions</legend>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {ADMIN_CAPABILITY_OPTIONS.map((capability) => (
                        <label key={capability.id} className="flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" name="capabilities" value={capability.id} defaultChecked={a.capabilities.includes(capability.id)} />
                          {capability.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="text-sm font-semibold text-slate-700">Departments/commissions (organizational only)</legend>
                    {departments.length ? (
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                        {departments.map((department) => (
                          <label key={department.id} className="flex items-center gap-2 text-sm text-slate-700">
                            <input type="checkbox" name="departments" value={department.id} defaultChecked={a.departmentIds.includes(department.id)} />
                            {department.name}
                          </label>
                        ))}
                      </div>
                    ) : <p className="mt-2 text-xs text-slate-500">No departments yet. Add them below.</p>}
                  </fieldset>
                  <button type="submit" disabled={busy} className={buttonClass("secondary", "sm")}>Save access assignments</button>
                </fetcher.Form>
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:px-5">
            You cannot remove yourself, and the last administrator cannot be removed.
          </p>
        </Panel>

        <Panel title="Departments and commissions" icon={UserPlusIcon}>
          <p className="mb-4 text-sm text-slate-600">
            These labels record organisational membership only; they do not grant or limit application access. Assign permission bundles separately.
          </p>
          <fetcher.Form method="post" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="create-department" />
            <TextField name="name" label="Department/commission name" required maxLength={80} placeholder="e.g. Membership Commission" />
            <button type="submit" disabled={busy} className={buttonClass("primary", "md")}>
              {busy ? <Spinner /> : <UserPlusIcon className="size-4" aria-hidden="true" />}
              Add department
            </button>
          </fetcher.Form>
          <Notice result={fetcher.data} className="mt-4" />
          {departments.length ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {departments.map((department) => (
                <li key={department.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{department.name}</li>
              ))}
            </ul>
          ) : <p className="mt-4 text-sm text-slate-500">No departments have been configured yet.</p>}
        </Panel>
      </div>
    </div>
  );
}
