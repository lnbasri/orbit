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
import { addAdmin, listAdmins, removeAdmin } from "~/lib/admins.server";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime } from "~/lib/format";

export function meta() {
  return [{ title: "Manage access — ORBIT" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  return { admins: await listAdmins(getAppEnv().DB), me: context.get(adminEmailContext) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const actor = context.get(adminEmailContext);
  if (intent === "add-admin") {
    return addAdmin(getAppEnv().DB, actor, String(form.get("email") ?? ""), String(form.get("name") ?? ""));
  }
  if (intent === "remove-admin") {
    return removeAdmin(getAppEnv().DB, actor, String(form.get("email") ?? ""));
  }
  return { ok: false, message: "Unknown action." };
}

export default function Admins({ loaderData }: Route.ComponentProps) {
  const { admins, me } = loaderData;
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
        description="Only people on this list can access ORBIT. Changes take effect immediately."
      />

      <div className="space-y-6">
        <Panel title="Add administrator" icon={UserPlusIcon}>
          <fetcher.Form ref={formRef} method="post" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="intent" value="add-admin" />
            <TextField
              name="email"
              type="email"
              label="Email"
              icon={EnvelopeIcon}
              required
              autoComplete="off"
              placeholder="nama@email.com"
            />
            <TextField
              name="name"
              label="Name (optional)"
              icon={UserIcon}
              maxLength={120}
              autoComplete="off"
              placeholder="Administrator"
            />
            <button type="submit" disabled={busy} className={buttonClass("primary", "md")}>
              {busy ? <Spinner /> : <UserPlusIcon className="size-4" aria-hidden="true" />}
              {busy ? "Saving…" : "Add"}
            </button>
          </fetcher.Form>
          <Notice result={fetcher.data} className="mt-4" />
          <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
            <InformationCircleIcon className="size-4 shrink-0" aria-hidden="true" />
            Administrators sign in with a one-time email code or Google (when enabled). Removing an administrator ends their sessions immediately.
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
                  <div className="mt-0.5 text-xs text-slate-500">
                    Added {formatDateTime(a.added_at)} by {a.added_by} · last login{" "}
                    {a.last_login_at ? formatDateTime(a.last_login_at) : "never"}
                  </div>
                </div>
                {a.email === me ? null : (
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
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:px-5">
            You cannot remove yourself, and the last administrator cannot be removed.
          </p>
        </Panel>
      </div>
    </div>
  );
}
