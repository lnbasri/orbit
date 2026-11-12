import type { ComponentProps, ComponentType, ReactNode } from "react";

/** Heroicons-compatible icon component. */
export type IconComponent = ComponentType<ComponentProps<"svg">>;

export type ButtonVariant = "primary" | "secondary" | "success" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-all duration-200 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white shadow-sm shadow-brand/20 hover:bg-brand-dark focus-visible:ring-brand disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none",
  secondary:
    "border border-slate-300 bg-white text-slate-700 shadow-xs hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 focus-visible:ring-brand disabled:text-slate-400",
  success:
    "bg-emerald-600 text-white shadow-sm shadow-emerald-700/20 hover:bg-emerald-700 focus-visible:ring-emerald-600 disabled:bg-slate-300 disabled:text-slate-500",
  danger:
    "bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-600 disabled:bg-slate-300 disabled:text-slate-500",
  ghost: "text-brand hover:bg-brand-50 hover:text-brand-dark focus-visible:ring-brand disabled:text-slate-400",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 py-1.5 text-[13px]",
  md: "min-h-11 px-4 py-2 text-sm",
  lg: "min-h-12 px-6 py-3 text-[15px]",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = "") {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${extra}`;
}

/** Small spinning ring shown inside a button while a form or fetcher is submitting. */
export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** PPME logo. Links to the association website. */
export function Logo({ className = "h-11 w-auto sm:h-14" }: { className?: string }) {
  return (
    <a
      href="https://www.ppmedenhaag.nl/"
      aria-label="PPME Den Haag – website"
      className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
    >
      <img src="/logo-ppme.png" alt="PPME Den Haag" width={135} height={70} className={className} />
    </a>
  );
}

/** Small uppercase label above a heading or value. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase ${className}`}>{children}</p>
  );
}

/** Page backdrop shared by the public form and the admin area (radial brand glow + fading grid). */
export function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="app-backdrop relative min-h-screen">
      <div className="app-grid pointer-events-none absolute inset-x-0 top-0 h-[26rem]" aria-hidden="true" />
      <div className="relative">{children}</div>
    </div>
  );
}

const CALLOUT_TONES = {
  info: "border-brand bg-brand-50/60 text-slate-700 [--icon:var(--color-brand)]",
  warning: "border-amber-500 bg-amber-50/70 text-amber-950 [--icon:var(--color-amber-600)]",
  danger: "border-red-600 bg-red-50/70 text-red-900 [--icon:var(--color-red-600)]",
  success: "border-emerald-600 bg-emerald-50/70 text-emerald-950 [--icon:var(--color-emerald-600)]",
  neutral: "border-slate-300 bg-slate-50/80 text-slate-700 [--icon:var(--color-slate-500)]",
} as const;

/** Flat callout with a left accent rule (replaces the old rounded coloured boxes). */
export function Callout({
  tone = "info",
  icon: Icon,
  title,
  children,
  role,
  className = "",
}: {
  tone?: keyof typeof CALLOUT_TONES;
  icon?: IconComponent;
  title?: ReactNode;
  children?: ReactNode;
  role?: "note" | "alert" | "status";
  className?: string;
}) {
  return (
    <div role={role} className={`flex gap-3 border-l-2 px-4 py-3 text-sm leading-relaxed ${CALLOUT_TONES[tone]} ${className}`}>
      {Icon ? <Icon className="mt-0.5 size-5 shrink-0 text-(--icon)" aria-hidden="true" /> : null}
      <div className="min-w-0 space-y-1.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}
