import type { ReactNode } from "react";
import { ArrowLeftIcon, CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router";

import type { IconComponent } from "~/components/ui";

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
          className="group mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-slate-500 hover:text-brand"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? <p className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-brand uppercase">{eyebrow}</p> : null}
          <h1 className="text-gradient-brand text-2xl font-bold tracking-tight sm:text-[1.75rem]">{title}</h1>
          {description ? <div className="mt-1.5 text-sm text-slate-500">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

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

export function EmptyState({ icon: Icon, children }: { icon?: IconComponent; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-slate-500">
      {Icon ? <Icon className="size-6 text-slate-300" aria-hidden="true" /> : null}
      {children}
    </div>
  );
}

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
