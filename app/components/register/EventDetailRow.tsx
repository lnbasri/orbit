import type { ReactNode } from "react";
import type { IconComponent } from "~/components/ui";

/** One metadata cell of the hero grid: small icon + uppercase label, value, optional secondary line. */
export function EventDetailRow({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: IconComponent;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="bg-white/90 px-5 py-4 sm:px-8 sm:py-5 lg:px-6 lg:first:pl-10 xl:py-6">
      <dt className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
        <Icon className="size-4 text-brand" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-2 text-[15px] leading-snug font-semibold text-slate-900">{value}</dd>
      {sub ? <dd className="mt-0.5 text-[13px] text-slate-500">{sub}</dd> : null}
    </div>
  );
}
