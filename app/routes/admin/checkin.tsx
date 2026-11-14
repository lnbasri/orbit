import { Switch } from "@headlessui/react";
import {
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  ExclamationTriangleIcon,
  LifebuoyIcon,
  NoSymbolIcon,
  QrCodeIcon,
  UserGroupIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";

import type { Route } from "./+types/checkin";
import { EmptyState, Notice, PageHeader, Panel, Stat, StatGroup } from "~/components/admin";
import { TextField } from "~/components/forms";
import { Callout, Spinner, buttonClass } from "~/components/ui";
import { handleAdminIntent } from "~/lib/admin-actions.server";
import { adminEmailContext } from "~/lib/admin-context";
import { gateState, gateWindow } from "~/lib/checkin.server";
import { getEventBySlug } from "~/lib/db.server";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime, utcIsoToLocalInput } from "~/lib/format";
import { checkinOverview } from "~/lib/scanners.server";

export function meta() {
  return [{ title: "Check-in – PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

export async function loader() {
  const env = getAppEnv();
  const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
  if (!event) throw new Response("Acara tidak ditemukan.", { status: 404 });
  const overview = await checkinOverview(env.DB, event);
  const window = gateWindow(event);
  return {
    ...overview,
    enabled: event.checkin_enabled === 1,
    gate: gateState(event, new Date()),
    opens: window.opens,
    closes: window.closes,
    opensOverride: utcIsoToLocalInput(event.checkin_opens_at),
    closesOverride: utcIsoToLocalInput(event.checkin_closes_at),
    custom: !!(event.checkin_opens_at || event.checkin_closes_at),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleAdminIntent(getAppEnv(), context.get(adminEmailContext), await request.formData());
}

const GATE_LABEL = { off: "Dimatikan", before: "Belum dibuka", open: "Terbuka", after: "Sudah ditutup" } as const;
const GATE_TONE = {
  off: "bg-red-50 text-red-700 ring-red-200",
  before: "bg-amber-50 text-amber-800 ring-amber-200",
  open: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  after: "bg-slate-100 text-slate-600 ring-slate-200",
} as const;

const ACTION_LABEL: Record<string, { text: string; tone: string }> = {
  admit: { text: "Check-in", tone: "text-emerald-700" },
  override: { text: "Check-in (izin ketua tim)", tone: "text-amber-700" },
  admin_admit: { text: "Check-in manual (admin)", tone: "text-emerald-700" },
  duplicate: { text: "Scan ganda", tone: "text-red-600" },
  blocked: { text: "Ditolak sistem", tone: "text-red-600" },
  invalid: { text: "Kode tidak dikenal", tone: "text-red-600" },
  deny: { text: "Ditolak petugas", tone: "text-slate-700" },
  undo: { text: "Dibatalkan petugas", tone: "text-amber-700" },
  admin_undo: { text: "Dibatalkan admin", tone: "text-amber-700" },
  escalate: { text: "Eskalasi", tone: "text-brand" },
};

const REASON_LABEL: Record<string, string> = {
  unknown_code: "kode tidak dikenal",
  ticket_revoked: "tiket dibatalkan",
  already_in: "sudah check-in",
  not_accepted: "pendaftaran belum diterima",
  payment_unclear: "pembayaran belum dikonfirmasi",
  gate_before: "pintu belum dibuka",
  gate_after: "pintu sudah ditutup",
  checkin_off: "check-in dimatikan",
  own_ticket: "tiket petugas sendiri",
  wrong_event: "acara lain",
  ticket_problem: "masalah tiket",
  behaviour: "perilaku",
  other: "lainnya",
};

function shortName(full: string | null) {
  if (!full) return "–";
  const parts = full.trim().split(/\s+/);
  return parts.length < 2 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export default function AdminCheckin({ loaderData }: Route.ComponentProps) {
  const d = loaderData;
  const { revalidate } = useRevalidator();
  useEffect(() => {
    const id = setInterval(() => void revalidate(), 15_000);
    return () => clearInterval(id);
  }, [revalidate]);

  const pct = d.stats.expected ? Math.round((d.stats.inside / d.stats.expected) * 100) : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Hari-H"
        title="Check-in"
        description="Tampilan langsung. Data diperbarui otomatis setiap 15 detik."
        actions={
          <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${GATE_TONE[d.gate]}`}>
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            Pintu: {GATE_LABEL[d.gate]}
          </span>
        }
      />

      <div className="space-y-6">
        <StatGroup>
          <Stat label="Sudah masuk" value={d.stats.inside} sub={`${pct}% dari yang diharapkan`} icon={CheckCircleIcon} />
          <Stat label="Diharapkan" value={d.stats.expected} sub="peserta dengan tiket sah" icon={UsersIcon} />
          <Stat label="Scan ganda / ditolak" value={(d.byAction.duplicate ?? 0) + (d.byAction.blocked ?? 0) + (d.byAction.invalid ?? 0)} sub="percobaan yang diblokir" icon={DocumentDuplicateIcon} />
          <Stat label="Eskalasi" value={d.byAction.escalate ?? 0} sub={`${d.byAction.deny ?? 0} penolakan · ${d.byAction.undo ?? 0} pembatalan`} icon={LifebuoyIcon} />
        </StatGroup>

        <Panel title="Per kategori" icon={UserGroupIcon}>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(["dewasa", "remaja", "anak", "balita"] as const).map((k) => (
              <div key={k}>
                <dt className="text-[13px] text-slate-500 capitalize">{k}</dt>
                <dd className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
                  {d.stats.byAge[k].inside}
                  <span className="text-sm font-normal text-slate-400"> / {d.stats.byAge[k].expected}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        <GatePanel d={d} />

        <Panel title="Aktivitas terbaru" icon={QrCodeIcon} flush>
          {d.recent.length === 0 ? (
            <EmptyState icon={QrCodeIcon}>Belum ada aktivitas check-in.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.recent.map((r) => {
                const a = ACTION_LABEL[r.action] ?? { text: r.action, tone: "text-slate-700" };
                return (
                  <li key={r.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-sm sm:px-5">
                    <span className="w-28 shrink-0 text-xs text-slate-500 tabular-nums">{formatDateTime(r.at).slice(11)}</span>
                    <span className={`w-48 shrink-0 font-medium ${a.tone}`}>{a.text}</span>
                    <span className="min-w-[8rem] flex-1 text-slate-900">
                      {shortName(r.participant)}
                      {r.reason ? <span className="text-slate-500"> · {REASON_LABEL[r.reason] ?? r.reason}</span> : null}
                    </span>
                    <span className="text-xs text-slate-500">
                      {r.scanner_label ?? "–"}
                      {r.device_label ? ` · ${r.device_label}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:px-5">
            Nama peserta ditampilkan singkat (nama depan + inisial). Check-in manual dan pembatalan per orang ada di halaman detail pendaftaran.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function GatePanel({ d }: { d: Route.ComponentProps["loaderData"] }) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const busy = fetcher.state !== "idle";
  const [enabled, setEnabled] = useState(d.enabled);
  useEffect(() => setEnabled(d.enabled), [d.enabled]);
  return (
    <Panel title="Pintu check-in" icon={ClockIcon}>
      <Callout tone={enabled ? "info" : "danger"} icon={enabled ? ClockIcon : NoSymbolIcon} className="mb-5">
        <p>
          {enabled ? "Jendela check-in saat ini: " : "Check-in dimatikan. "}
          <span className="font-semibold">
            {formatDateTime(d.opens)} – {formatDateTime(d.closes)}
          </span>{" "}
          waktu Belanda{d.custom ? " (diatur manual)." : " (standar: 1 jam sebelum acara sampai 1 jam setelah selesai)."}
        </p>
      </Callout>
      <fetcher.Form method="post" className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="intent" value="save-checkin-gate" />
        <div className="flex items-start justify-between gap-4 sm:col-span-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{enabled ? "Check-in aktif" : "Check-in dimatikan (semua perangkat petugas ditolak)"}</p>
            <p className="mt-1 text-sm text-slate-600">Saklar darurat: berlaku seketika di semua ponsel petugas.</p>
          </div>
          <Switch
            name="enabled"
            value="1"
            checked={enabled}
            onChange={setEnabled}
            aria-label="Check-in aktif"
            className="group relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border border-slate-300 bg-slate-200 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand data-checked:border-brand data-checked:bg-brand"
          >
            <span className="pointer-events-none inline-block size-5 translate-x-0.5 translate-y-px rounded-full bg-white shadow transition-transform group-data-checked:translate-x-5" />
          </Switch>
        </div>
        <TextField name="opensAt" type="datetime-local" label="Buka check-in (kosong = standar)" defaultValue={d.opensOverride} />
        <TextField name="closesAt" type="datetime-local" label="Tutup check-in (kosong = standar)" defaultValue={d.closesOverride} />
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
            {busy ? <Spinner /> : <CheckCircleIcon className="size-4" aria-hidden="true" />}
            {busy ? "Menyimpan…" : "Simpan"}
          </button>
          <button type="reset" disabled={busy} className={buttonClass("secondary", "md", "mt-2 w-full sm:mt-0 sm:ml-2 sm:w-auto")}>
            <ArrowUturnLeftIcon className="size-4" aria-hidden="true" />
            Reset
          </button>
        </div>
      </fetcher.Form>
      <Notice result={fetcher.data} className="mt-4" />
      <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
        <ExclamationTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
        Di luar jendela ini tiket sah berstatus kuning: hanya ketua tim yang dapat mengizinkan. Waktu dibaca sebagai waktu Belanda.
      </p>
    </Panel>
  );
}
