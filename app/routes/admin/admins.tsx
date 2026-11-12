import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import type { Route } from "./+types/admins";
import {
  EnvelopeIcon,
  InformationCircleIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { ActionButton, Notice, PageHeader, Panel } from "~/components/admin";
import { TextField } from "~/components/forms";
import { Spinner, buttonClass } from "~/components/ui";
import { handleAdminIntent } from "~/lib/admin-actions.server";
import { adminEmailContext } from "~/lib/admin-context";
import { listAdmins } from "~/lib/admins.server";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime } from "~/lib/format";

export function meta() {
  return [{ title: "Kelola Admin – PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  return { admins: await listAdmins(getAppEnv().DB), me: context.get(adminEmailContext) };
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleAdminIntent(getAppEnv(), context.get(adminEmailContext), await request.formData());
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
        eyebrow="Akses"
        title={
          <>
            Kelola admin <span className="text-slate-400 tabular-nums">({admins.length})</span>
          </>
        }
        description="Hanya orang dalam daftar ini yang dapat membuka dashboard panitia. Perubahan berlaku seketika."
      />

      <div className="space-y-6">
        <Panel title="Tambah admin" icon={UserPlusIcon}>
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
              label="Nama (opsional)"
              icon={UserIcon}
              maxLength={120}
              autoComplete="off"
              placeholder="Nama panitia"
            />
            <button type="submit" disabled={busy} className={buttonClass("primary", "md")}>
              {busy ? <Spinner /> : <UserPlusIcon className="size-4" aria-hidden="true" />}
              {busy ? "Menyimpan…" : "Tambah"}
            </button>
          </fetcher.Form>
          <Notice result={fetcher.data} className="mt-4" />
          <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
            <InformationCircleIcon className="size-4 shrink-0" aria-hidden="true" />
            Orang yang ditambahkan login lewat Cloudflare Access dengan kode sekali pakai yang dikirim ke emailnya.
          </p>
        </Panel>

        <Panel title="Daftar admin" icon={ShieldCheckIcon} flush>
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
                        Anda
                      </span>
                    ) : null}
                  </div>
                  {a.name ? <div className="text-sm text-slate-600">{a.name}</div> : null}
                  <div className="mt-0.5 text-xs text-slate-500">
                    Ditambahkan {formatDateTime(a.added_at)} oleh {a.added_by} · login terakhir{" "}
                    {a.last_login_at ? formatDateTime(a.last_login_at) : "belum pernah"}
                  </div>
                </div>
                {a.email === me ? null : (
                  <ActionButton
                    intent="remove-admin"
                    label="Hapus"
                    tone="neutral"
                    icon={TrashIcon}
                    extra={{ email: a.email }}
                    confirm={{
                      title: "Hapus admin",
                      description: `${a.email} akan dihapus dari daftar admin dan tidak bisa lagi membuka dashboard panitia.`,
                      confirmLabel: "Ya, hapus",
                      tone: "danger",
                      icon: UserMinusIcon,
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:px-5">
            Anda tidak dapat menghapus diri sendiri, dan admin terakhir tidak dapat dihapus.
          </p>
        </Panel>
      </div>
    </div>
  );
}
