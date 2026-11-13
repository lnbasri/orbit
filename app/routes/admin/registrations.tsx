import { useState } from "react";
import { Form, Link, data, useSearchParams } from "react-router";
import {
  ArrowDownTrayIcon,
  BanknotesIcon,
  CheckBadgeIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  NoSymbolIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import type { Route } from "./+types/registrations";
import { ActionButton, DeleteRegistrationButton, EmptyState, PageHeader, Panel, StatusBadge } from "~/components/admin";
import { ListboxSelect, TextField, type SelectOption } from "~/components/forms";
import { buttonClass } from "~/components/ui";
import { handleAdminIntent } from "~/lib/admin-actions.server";
import { adminEmailContext } from "~/lib/admin-context";
import { listRegistrations, type RegistrationFilters } from "~/lib/admin.server";
import { getEventBySlug } from "~/lib/db.server";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime, formatEuro, PAYMENT_STATUS_LABEL } from "~/lib/format";
import type { RegistrationListRow } from "~/lib/admin.server";

function filtersFrom(url: URL): RegistrationFilters {
  const p = url.searchParams;
  return {
    q: p.get("q") ?? "",
    email: p.get("email") ?? "",
    status: p.get("status") ?? "",
    member: (p.get("member") ?? "") as RegistrationFilters["member"],
    source: (p.get("source") ?? "") as RegistrationFilters["source"],
    page: Number(p.get("page") ?? 1) || 1,
  };
}

export async function loader({ url }: Route.LoaderArgs) {
  const env = getAppEnv();
  const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
  if (!event) throw data("Acara tidak ditemukan.", { status: 404 });
  const filters = filtersFrom(url);
  return { filters, ...(await listRegistrations(env.DB, event, filters)) };
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleAdminIntent(getAppEnv(), context.get(adminEmailContext), await request.formData());
}

/** Quick actions for one record: verify / reject an unverified member, confirm a pending payment. */
function rowActions(r: RegistrationListRow) {
  return {
    member: !!r.is_member && r.status === "accepted" && !r.membership_verified_at,
    payment: r.effective_status === "pending_payment" && r.payment_status === "pending",
    revive: !!r.is_member && r.status === "rejected_membership",
  };
}

function RowActions({ r }: { r: RegistrationListRow }) {
  const a = rowActions(r);
  const name = r.registrant_name;
  return (
    <div className="flex items-start gap-3">
    <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
      {a.revive ? (
        <ActionButton
          intent="verify-membership"
          registrationId={r.id}
          label="Validasi anggota (aktifkan kembali)"
          icon={CheckBadgeIcon}
          tone="primary"
          size="md"
          fullWidthOnMobile
          confirm={{
            title: "Aktifkan kembali pendaftaran",
            description: (
              <>
                Keanggotaan <strong>{name}</strong> ternyata valid? Pendaftaran akan diaktifkan kembali dan QR Code baru
                dikirim ke pendaftar.
              </>
            ),
            confirmLabel: "Ya, aktifkan kembali",
            tone: "info",
            icon: CheckBadgeIcon,
          }}
        />
      ) : null}
      {a.member ? (
        <>
          <ActionButton
            intent="verify-membership"
            registrationId={r.id}
            label="Validasi anggota"
            icon={CheckBadgeIcon}
            tone="primary"
            size="md"
            fullWidthOnMobile
            confirm={{
              title: "Validasi keanggotaan",
              description: (
                <>
                  Apakah <strong>{name}</strong> sudah dicek dan benar terdaftar di daftar anggota PPME Den Haag?
                </>
              ),
              confirmLabel: "Ya, anggota valid",
              tone: "info",
              icon: CheckBadgeIcon,
            }}
          />
          <ActionButton
            intent="reject-membership"
            registrationId={r.id}
            label="Tolak (bukan anggota)"
            icon={NoSymbolIcon}
            tone="danger"
            size="md"
            fullWidthOnMobile
            confirm={{
              title: "Tolak pendaftaran",
              description: (
                <>
                  Keanggotaan <strong>{name}</strong> tidak dapat divalidasi? Pendaftaran akan ditolak, QR Code
                  dibatalkan dan kursi dibebaskan. Tidak ada email otomatis yang dikirim.
                </>
              ),
              confirmLabel: "Ya, tolak",
              tone: "danger",
              icon: NoSymbolIcon,
            }}
          />
        </>
      ) : null}
      {a.payment ? (
        <ActionButton
          intent="confirm-payment"
          registrationId={r.id}
          label="Verifikasi pembayaran"
          icon={CheckIcon}
          tone="success"
          size="md"
          fullWidthOnMobile
          confirm={{
            title: "Verifikasi pembayaran",
            description: (
              <>
                Pembayaran <strong>{name}</strong> ({r.payment_code}, {formatEuro(r.amount_cents)}) sudah benar-benar
                diterima di rekening PPME? QR Code akan langsung dikirim ke pendaftar.
              </>
            ),
            confirmLabel: "Ya, pembayaran diterima",
            tone: "info",
            icon: BanknotesIcon,
          }}
        />
      ) : null}
    </div>
    <DeleteRegistrationButton registrationId={r.id} name={name} />
    </div>
  );
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: "", label: "Semua status" },
  { value: "accepted", label: "Diterima" },
  { value: "pending_payment", label: "Menunggu pembayaran" },
  { value: "expired", label: "Kedaluwarsa" },
  { value: "rejected_quota", label: "Ditolak (kuota)" },
  { value: "rejected_membership", label: "Ditolak (keanggotaan tidak valid)" },
];
const MEMBER_OPTIONS: SelectOption[] = [
  { value: "", label: "Anggota & non-anggota" },
  { value: "1", label: "Anggota" },
  { value: "0", label: "Non-anggota" },
];
const EMAIL_OPTIONS: SelectOption[] = [
  { value: "", label: "Semua email" },
  { value: "unsent", label: "Email belum terkirim" },
];
const SOURCE_OPTIONS: SelectOption[] = [
  { value: "", label: "Online & manual" },
  { value: "online", label: "Online" },
  { value: "manual", label: "Manual" },
];

function FilterForm({ filters }: { filters: RegistrationFilters }) {
  const [status, setStatus] = useState(filters.status ?? "");
  const [member, setMember] = useState<string>(filters.member ?? "");
  const [source, setSource] = useState<string>(filters.source ?? "");
  const [email, setEmail] = useState<string>(filters.email ?? "");
  const active = !!(filters.q || filters.status || filters.member || filters.source || filters.email);

  return (
    <Form
      method="get"
      className="grid gap-2 border-b border-slate-200/80 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]"
    >
      <TextField
        name="q"
        label="Cari pendaftaran"
        hideLabel
        icon={MagnifyingGlassIcon}
        defaultValue={filters.q}
        placeholder="Cari nama, email, WA, kode bayar"
        autoComplete="off"
        className="sm:col-span-2 lg:col-span-1"
      />
      <ListboxSelect name="status" label="Filter status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      <ListboxSelect name="member" label="Filter keanggotaan" value={member} onChange={setMember} options={MEMBER_OPTIONS} />
      <ListboxSelect name="source" label="Filter cara pendaftaran" value={source} onChange={setSource} options={SOURCE_OPTIONS} />
      <ListboxSelect name="email" label="Filter status email" value={email} onChange={setEmail} options={EMAIL_OPTIONS} />
      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <button type="submit" className={buttonClass("primary", "md", "flex-1 lg:flex-none")}>
          <FunnelIcon className="size-4" aria-hidden="true" />
          Cari
        </button>
        {active ? (
          <Link to="/admin/registrations" className={buttonClass("secondary", "md")}>
            <XMarkIcon className="size-4" aria-hidden="true" />
            Reset
          </Link>
        ) : null}
      </div>
    </Form>
  );
}

export default function Registrations({ loaderData }: Route.ComponentProps) {
  const { rows, total, page, pageSize, filters } = loaderData;
  const [params] = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const withPage = (n: number) => {
    const p = new URLSearchParams(params);
    p.set("page", String(n));
    return `?${p}`;
  };
  const exportParams = new URLSearchParams(params);
  exportParams.delete("page");

  return (
    <div>
      <PageHeader
        eyebrow="Pendaftaran"
        title={
          <>
            Pendaftaran <span className="text-slate-400 tabular-nums">({total})</span>
          </>
        }
        description="Semua pendaftaran online dan manual untuk acara ini."
        actions={
          <a href={`/admin/export?${exportParams}`} className={buttonClass("secondary", "md")}>
            <ArrowDownTrayIcon className="size-4" aria-hidden="true" />
            Unduh CSV (filter ini)
          </a>
        }
      />

      <Panel flush>
        {/* key = current query string: remounts the controls when a link/redirect changes the filters */}
        <FilterForm key={params.toString()} filters={filters} />

        {rows.length === 0 ? (
          <EmptyState icon={MagnifyingGlassIcon}>Tidak ada data.</EmptyState>
        ) : (
          <>
            {/* Mobile: list */}
            <ul className="divide-y divide-slate-300 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="py-2">
                  <Link to={`/admin/registrations/${r.id}`} className="block px-4 pt-3.5 pb-3 active:bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900">{r.registrant_name}</div>
                        <div className="mt-0.5 truncate text-xs text-slate-500">{r.email}</div>
                      </div>
                      <StatusBadge status={r.effective_status} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                      <span>{r.is_member ? "Anggota" : "Non-anggota"}</span>
                      <span>{r.people} peserta</span>
                      {r.payment_code ? <span className="font-mono">{r.payment_code}</span> : null}
                      <span className="text-slate-400">{formatDateTime(r.created_at)}</span>
                    </div>
                  </Link>
                  <div className="px-4 pb-4">
                    <RowActions r={r} />
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-slate-50/80 text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">
                    <th className="px-4 py-2.5 font-semibold sm:pl-5">Waktu</th>
                    <th className="px-4 py-2.5 font-semibold">Pendaftar</th>
                    <th className="px-4 py-2.5 font-semibold">Kategori</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Peserta</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold">Pembayaran</th>
                    <th className="px-4 py-2.5 text-right font-semibold sm:pr-5">Check-in</th>
                  </tr>
                </thead>
                {rows.map((r) => (
                  <tbody key={r.id} className="border-t border-slate-300 first:border-t-0">
                    <tr className="transition-colors hover:bg-brand-50/40">
                      <td className="px-4 py-4 whitespace-nowrap text-slate-500 tabular-nums sm:pl-5">
                        {formatDateTime(r.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/admin/registrations/${r.id}`}
                          className="font-semibold text-slate-900 hover:text-brand"
                        >
                          {r.registrant_name}
                        </Link>
                        <div className="text-xs text-slate-500">{r.email}</div>
                      </td>
                      <td className="px-4 py-4 text-slate-700">
                        {r.is_member ? "Anggota" : "Non-anggota"}
                        {r.source === "manual" ? <span className="ml-1 text-xs text-slate-500">(manual)</span> : null}
                        {r.is_member && r.status === "accepted" && !r.membership_verified_at ? (
                          <div className="text-xs text-amber-700">belum diverifikasi</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-4 text-right text-slate-700 tabular-nums">{r.people}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.effective_status} />
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-600">
                        {r.payment_code ? <div className="font-mono text-slate-900">{r.payment_code}</div> : null}
                        {PAYMENT_STATUS_LABEL[r.payment_status]}
                        {r.amount_cents ? ` · ${formatEuro(r.amount_cents)}` : ""}
                      </td>
                      <td className="px-4 py-4 text-right text-slate-700 tabular-nums sm:pr-5">
                        {r.checked_in}/{r.people}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={7} className="px-4 pt-1 pb-4 sm:px-5">
                        <RowActions r={r} />
                      </td>
                    </tr>
                  </tbody>
                ))}
              </table>
            </div>

            {pages > 1 ? (
              <nav
                aria-label="Halaman"
                className="flex items-center justify-between gap-3 border-t border-slate-200/80 px-4 py-3 text-sm sm:px-5"
              >
                {page > 1 ? (
                  <Link to={withPage(page - 1)} className={buttonClass("secondary", "sm")}>
                    <ChevronLeftIcon className="size-4" aria-hidden="true" />
                    Sebelumnya
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-slate-500 tabular-nums">
                  Halaman {page} / {pages}
                </span>
                {page < pages ? (
                  <Link to={withPage(page + 1)} className={buttonClass("secondary", "sm")}>
                    Berikutnya
                    <ChevronRightIcon className="size-4" aria-hidden="true" />
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  );
}
