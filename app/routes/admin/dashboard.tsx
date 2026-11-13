import { Link, data } from "react-router";

import type { Route } from "./+types/dashboard";
import {
  ArrowPathIcon,
  ArrowUpRightIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  EnvelopeIcon,
  IdentificationIcon,
  InboxStackIcon,
  QrCodeIcon,
  UsersIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import {
  AgeGroupChart,
  QuotaDonut,
  RegistrationTimeline,
} from "~/components/admin-charts";
import {
  ActionButton,
  EmptyState,
  PageHeader,
  Panel,
  Stat,
  StatGroup,
} from "~/components/admin";
import type { IconComponent } from "~/components/ui";
import { handleAdminIntent } from "~/lib/admin-actions.server";
import { adminEmailContext } from "~/lib/admin-context";
import { dashboardStats } from "~/lib/admin.server";
import { getEventBySlug } from "~/lib/db.server";
import { getAppEnv } from "~/lib/env.server";
import { daysUntil, formatDateTime, formatEuro } from "~/lib/format";

export async function loader() {
  const env = getAppEnv();
  const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
  if (!event) throw data("Acara tidak ditemukan.", { status: 404 });
  const stats = await dashboardStats(env.DB, event);
  // The public form lives on a different origin (public Worker), so the link must be absolute.
  const base = env.PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const publicFormUrl = base ? `${base}/e/${event.slug}` : null;
  const daysLeft = daysUntil(event.starts_at, new Date());
  return {
    event: { title: event.title, slug: event.slug, startsAt: event.starts_at },
    publicFormUrl,
    stats,
    daysLeft,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleAdminIntent(
    getAppEnv(),
    context.get(adminEmailContext),
    await request.formData(),
  );
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { event, stats, publicFormUrl, daysLeft } = loaderData;
  const s = (k: string) => stats.statuses[k] ?? { families: 0, people: 0 };
  const totalFamilies = Object.values(stats.statuses).reduce(
    (n, v) => n + v.families,
    0,
  );
  const checkinPct = stats.checkin.accepted
    ? Math.round((stats.checkin.checkedIn / stats.checkin.accepted) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ringkasan"
        title={event.title}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDaysIcon
                className="size-4 text-slate-400"
                aria-hidden="true"
              />
              {formatDateTime(event.startsAt)}
            </span>
            {publicFormUrl && (
              <a
                className="inline-flex items-center gap-1 font-medium text-brand hover:text-brand-dark"
                href={publicFormUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Formulir publik
                <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
              </a>
            )}
          </span>
        }
        actions={
          <ActionButton
            intent="run-job"
            label="Jalankan job tenggat sekarang"
            tone="neutral"
            icon={ArrowPathIcon}
          />
        }
      />

      <Countdown daysLeft={daysLeft} />

      <StatGroup>
        <Stat
          icon={UsersIcon}
          label="Pendaftaran (keluarga)"
          value={totalFamilies}
        />
        <Stat
          icon={CheckCircleIcon}
          label="Diterima"
          value={s("accepted").families}
          sub={`${s("accepted").people} peserta`}
        />
        <Stat
          icon={ClockIcon}
          label="Menunggu pembayaran"
          value={s("pending_payment").families}
          sub={`${s("pending_payment").people} peserta`}
        />
        <Stat
          icon={XCircleIcon}
          label="Kedaluwarsa / ditolak"
          value={`${s("expired").families} / ${s("rejected_quota").families}`}
          sub={`${s("expired").people} / ${s("rejected_quota").people} peserta`}
        />
      </StatGroup>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="Pendaftaran per hari"
          icon={ChartBarIcon}
          className="lg:col-span-2"
        >
          {stats.timeline.length === 0 ? (
            <EmptyState icon={ChartBarIcon}>Belum ada pendaftaran.</EmptyState>
          ) : (
            <RegistrationTimeline data={stats.timeline} />
          )}
        </Panel>
        <Panel title="Anggota vs non-anggota" icon={UsersIcon}>
          <QuotaDonut
            member={stats.quota.member}
            nonMember={stats.quota.nonMember}
          />
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Kursi terisi = diterima + menunggu pembayaran (belum lewat batas).
            Pendaftaran manual tidak dihitung.
          </p>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Kuota online" icon={ChartBarIcon}>
          <div className="space-y-5">
            {(
              [
                ["Anggota", stats.quota.member],
                ["Non-anggota", stats.quota.nonMember],
              ] as const
            ).map(([label, q]) => {
              const pct = q.quota ? Math.min(100, (q.used / q.quota) * 100) : 0;
              return (
                <div key={label}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium text-slate-700">{label}</span>
                    <span className="text-slate-500 tabular-nums">
                      <span className="font-semibold text-slate-900">
                        {q.used}
                      </span>{" "}
                      / {q.quota}
                    </span>
                  </div>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"
                    role="progressbar"
                    aria-label={`Kuota ${label}`}
                    aria-valuemin={0}
                    aria-valuemax={q.quota}
                    aria-valuenow={q.used}
                  >
                    <div
                      className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : "bg-brand"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1.5 text-xs text-slate-500">
                    Sisa {q.remaining} (termasuk yang menunggu pembayaran)
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
            Pendaftaran manual tidak dihitung dalam kuota.
          </p>
        </Panel>

        <Panel title="Check-in" icon={QrCodeIcon}>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {stats.checkin.checkedIn}
            </span>
            <span className="text-lg text-slate-400 tabular-nums">
              / {stats.checkin.accepted}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            peserta diterima sudah check-in
          </p>
          <div
            className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-100"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${checkinPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            {checkinPct}%
          </p>
        </Panel>

        <Panel title="Perlu ditinjau" icon={InboxStackIcon} flush>
          <ul className="divide-y divide-slate-100 text-sm">
            <ReviewRow
              to="/admin/registrations?status=pending_payment"
              icon={BanknotesIcon}
              count={stats.pendingPayments.length}
            >
              pembayaran menunggu konfirmasi
            </ReviewRow>
            <ReviewRow
              to="/admin/registrations?member=1&status=accepted"
              icon={IdentificationIcon}
              count={stats.unverifiedMembers}
            >
              anggota belum diverifikasi
            </ReviewRow>
            {stats.unsentEmails > 0 ? (
              <ReviewRow
                to="/admin/registrations?email=unsent"
                icon={EnvelopeIcon}
                count={stats.unsentEmails}
                alert
              >
                email belum terkirim
              </ReviewRow>
            ) : (
              <li className="flex items-center gap-3 px-4 py-3 text-emerald-700 sm:px-5">
                <CheckCircleIcon
                  className="size-4 shrink-0"
                  aria-hidden="true"
                />
                Semua email sudah terkirim
              </li>
            )}
            <li className="px-4 py-3 text-xs text-slate-500 sm:px-5">
              Online {stats.bySource.online ?? 0} · Manual{" "}
              {stats.bySource.manual ?? 0} peserta diterima
            </li>
          </ul>
        </Panel>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Panel title="Kelompok usia peserta" icon={UsersIcon}>
          <AgeGroupChart data={stats.ageGroups} />
        </Panel>
        <Panel
          title={`Menunggu konfirmasi pembayaran (${stats.pendingPayments.length})`}
          icon={BanknotesIcon}
          flush
          className="lg:col-span-2"
        >
          {stats.pendingPayments.length === 0 ? (
            <EmptyState icon={CheckCircleIcon}>
              Tidak ada pembayaran yang menunggu konfirmasi.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {stats.pendingPayments.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-5"
                >
                  <div className="min-w-[200px] flex-1">
                    <Link
                      to={`/admin/registrations/${r.id}`}
                      className="font-semibold text-slate-900 hover:text-brand"
                    >
                      {r.registrant_name}
                    </Link>
                    <div className="text-xs break-all text-slate-500">
                      {r.email}
                    </div>
                  </div>
                  <div className="font-mono text-sm font-semibold text-brand">
                    {r.payment_code}
                  </div>
                  <div className="text-sm text-slate-600 tabular-nums">
                    {r.people} org ·{" "}
                    <span className="font-semibold text-slate-900">
                      {formatEuro(r.amount_cents)}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <ClockIcon className="size-3.5" aria-hidden="true" />
                    batas {formatDateTime(r.pay_deadline)}
                  </div>
                  <ActionButton
                    intent="confirm-payment"
                    registrationId={r.id}
                    label="Konfirmasi pembayaran"
                    tone="success"
                    icon={CheckIcon}
                    confirm={{
                      title: "Konfirmasi pembayaran",
                      description: `Pembayaran ${r.payment_code} sebesar ${formatEuro(r.amount_cents)} sudah benar-benar diterima di rekening PPME? QR Code akan langsung dikirim ke pendaftar.`,
                      confirmLabel: "Ya, konfirmasi",
                      tone: "info",
                      icon: BanknotesIcon,
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Countdown({ daysLeft }: { daysLeft: number }) {
  const today = daysLeft === 0;
  const past = daysLeft < 0;
  return (
    <div className="flex items-center gap-4 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 sm:px-5">
      <CalendarDaysIcon
        className="size-6 shrink-0 text-brand"
        aria-hidden="true"
      />
      <div className="flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {past ? (
          <span className="text-sm font-semibold text-brand-dark">
            Acara sudah selesai
          </span>
        ) : today ? (
          <span className="text-lg font-semibold text-brand-dark">
            Acara hari ini!
          </span>
        ) : (
          <>
            <span className="text-3xl font-semibold tracking-tight text-brand-dark tabular-nums">
              {daysLeft}
            </span>
            <span className="text-sm font-medium text-brand-dark">
              hari lagi menuju acara
            </span>
          </>
        )}
      </div>
      {!past && !today && daysLeft <= 7 ? (
        <span className="rounded-md border border-brand-200 bg-white px-2 py-1 text-xs font-semibold text-brand">
          H-{daysLeft}
        </span>
      ) : null}
    </div>
  );
}

function ReviewRow({
  to,
  icon: Icon,
  count,
  alert = false,
  children,
}: {
  to: string;
  icon: IconComponent;
  count: number;
  alert?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        to={to}
        className={`group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 sm:px-5 ${
          alert ? "text-red-700" : "text-slate-700"
        }`}
      >
        <Icon
          className={`size-4 shrink-0 ${alert ? "text-red-500" : "text-slate-400"}`}
          aria-hidden="true"
        />
        <span className="flex-1">
          <span className="font-semibold tabular-nums">{count}</span> {children}
        </span>
        <ChevronRightIcon
          className="size-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}
