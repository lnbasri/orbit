import { useState, type ReactNode } from "react";
import { ArrowLeftIcon, CheckCircleIcon, TrashIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { Link, useFetcher } from "react-router";

import { ConfirmDialog, type ConfirmConfig } from "~/components/ConfirmDialog";
import { Spinner, buttonClass, type IconComponent } from "~/components/ui";
import { PAYMENT_STATUS_LABEL, REGISTRATION_STATUS_LABEL } from "~/lib/format";

const STATUS_STYLE: Record<string, { badge: string; dot: string }> = {
  accepted: { badge: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "bg-emerald-500" },
  pending_payment: { badge: "bg-amber-50 text-amber-800 ring-amber-600/25", dot: "bg-amber-500" },
  pending_membership: { badge: "bg-sky-50 text-sky-800 ring-sky-600/25", dot: "bg-sky-500" },
  expired: { badge: "bg-slate-50 text-slate-600 ring-slate-500/20", dot: "bg-slate-400" },
  rejected_quota: { badge: "bg-red-50 text-red-700 ring-red-600/20", dot: "bg-red-500" },
  rejected_membership: { badge: "bg-rose-50 text-rose-700 ring-rose-600/20", dot: "bg-rose-500" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.expired;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${s.badge}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {REGISTRATION_STATUS_LABEL[status] ?? status}
    </span>
  );
}

const PAYMENT_STYLE: Record<string, string> = {
  paid: "text-emerald-700",
  pending: "text-amber-700",
  expired: "text-slate-500",
  free: "text-slate-600",
};

export function PaymentBadge({ status }: { status: string }) {
  return (
    <span className={`text-sm font-medium ${PAYMENT_STYLE[status] ?? "text-slate-600"}`}>
      {PAYMENT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Page title row: optional back link and eyebrow, title, description and actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <div className="mb-6 sm:mb-8">
      {back ? (
        <Link
          to={back.to}
          className="group mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-slate-500 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <ArrowLeftIcon className="size-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-brand uppercase">{eyebrow}</p>
          ) : null}
          <h1 className="text-gradient-brand text-2xl font-bold tracking-tight sm:text-[1.75rem]">{title}</h1>
          {description ? <div className="mt-1.5 text-sm text-slate-500">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Flat bordered panel with a header strip. `flush` removes body padding (for lists and tables). */
export function Panel({
  title,
  icon: Icon,
  actions,
  children,
  flush = false,
  className = "",
}: {
  title?: ReactNode;
  icon?: IconComponent;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-lg border border-slate-200/80 bg-white/85 backdrop-blur-md ${className}`}>
      {title ? (
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-2.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            {Icon ? <Icon className="size-4 text-brand" aria-hidden="true" /> : null}
            {title}
          </h2>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

/** One row of stats separated by hairlines (2 columns on phones, 4 on desktop). */
export function StatGroup({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200/80 bg-slate-200/80 lg:grid-cols-4">
      {children}
    </dl>
  );
}

export function Stat({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: IconComponent;
}) {
  return (
    <div className="bg-white/90 px-4 py-4 sm:px-5 sm:py-5">
      <dt className="flex items-center gap-2 text-[13px] font-medium text-slate-500">
        {Icon ? <Icon className="size-4 text-slate-400" aria-hidden="true" /> : null}
        {label}
      </dt>
      <dd className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums sm:text-3xl">{value}</dd>
      {sub ? <dd className="mt-1 text-xs text-slate-500">{sub}</dd> : null}
    </div>
  );
}

/** Label/value rows separated by hairlines. */
export function DetailList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-y divide-slate-100 text-sm">
      {items.map(([label, value], i) => (
        <div key={i} className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-slate-500">{label}</dt>
          <dd className="min-w-0 text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ icon: Icon, children }: { icon?: IconComponent; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-slate-500">
      {Icon ? <Icon className="size-6 text-slate-300" aria-hidden="true" /> : null}
      {children}
    </div>
  );
}

/** Result message with an icon: green check for success, red cross for failure. */
export function Notice({
  result,
  className = "",
}: {
  result?: { ok: boolean; message: string } | null;
  className?: string;
}) {
  if (!result) return null;
  const Icon = result.ok ? CheckCircleIcon : XCircleIcon;
  return (
    <p
      role="status"
      className={`flex items-start gap-2.5 border-l-2 px-3 py-2.5 text-sm ${
        result.ok ? "border-emerald-600 bg-emerald-50/80 text-emerald-900" : "border-red-600 bg-red-50/80 text-red-800"
      } ${className}`}
    >
      <Icon className={`mt-px size-5 shrink-0 ${result.ok ? "text-emerald-600" : "text-red-600"}`} aria-hidden="true" />
      <span>{result.message}</span>
    </p>
  );
}

export function Flash({ result }: { result?: { ok: boolean; message: string } | null }) {
  return <Notice result={result} className="mb-4" />;
}

/** Trash icon button with a red yes/no confirmation naming the registrant. Permanent; written to the audit log. */
export function DeleteRegistrationButton({ registrationId, name }: { registrationId: string; name: string }) {
  return (
    <ActionButton
      intent="delete-registration"
      registrationId={registrationId}
      label="Hapus pendaftaran"
      icon={TrashIcon}
      iconOnly
      confirm={{
        title: "Hapus pendaftaran",
        description: (
          <>
            Hapus pendaftaran <strong>{name}</strong> beserta seluruh pesertanya secara permanen? Tindakan ini tidak
            dapat dibatalkan (dicatat di audit log).
          </>
        ),
        confirmLabel: "Ya, hapus",
        tone: "danger",
        icon: TrashIcon,
      }}
    />
  );
}

const TONE_VARIANT ={ primary: "primary", success: "success", neutral: "secondary", danger: "danger" } as const;

/**
 * Posts an admin intent to the current route. With `confirm`, a modal asks first
 * (blue = normal confirmation, red = destructive). The result appears next to the button.
 */
export function ActionButton({
  intent,
  registrationId,
  label,
  confirm,
  extra,
  tone = "primary",
  icon: Icon,
  size = "sm",
  fullWidthOnMobile = false,
  iconOnly = false,
}: {
  intent: string;
  registrationId?: string;
  label: string;
  confirm?: ConfirmConfig;
  extra?: Record<string, string>;
  tone?: keyof typeof TONE_VARIANT;
  icon?: IconComponent;
  size?: "sm" | "md";
  /** Full-width, taller tap target below the md breakpoint (where the list switches to a table) (used for the per-row actions). */
  fullWidthOnMobile?: boolean;
  /** Square red-outline icon button (label becomes the aria-label/tooltip), e.g. the trash button. */
  iconOnly?: boolean;
}) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const [asking, setAsking] = useState(false);
  const busy = fetcher.state !== "idle";

  const submit = () => fetcher.submit({ intent, ...(registrationId ? { registrationId } : {}), ...extra }, { method: "post" });

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-2 ${fullWidthOnMobile ? "w-full md:w-auto" : ""}`}>
      <button
        type="button"
        disabled={busy}
        onClick={() => (confirm ? setAsking(true) : submit())}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        className={
          iconOnly
            ? "inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-slate-400 md:size-10"
            : buttonClass(TONE_VARIANT[tone], size, fullWidthOnMobile ? "w-full md:w-auto" : "")
        }
      >
        {busy ? <Spinner /> : Icon ? <Icon className={iconOnly ? "size-5" : "size-4"} aria-hidden="true" /> : null}
        {iconOnly ? null : busy ? "Memproses…" : label}
      </button>
      {fetcher.data ? (
        <span
          role="status"
          className={`inline-flex items-center gap-1.5 text-sm ${fetcher.data.ok ? "text-emerald-700" : "text-red-600"}`}
        >
          {fetcher.data.ok ? (
            <CheckCircleIcon className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <XCircleIcon className="size-4 shrink-0" aria-hidden="true" />
          )}
          {fetcher.data.message}
        </span>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          {...confirm}
          open={asking}
          onClose={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            submit();
          }}
        />
      ) : null}
    </span>
  );
}
