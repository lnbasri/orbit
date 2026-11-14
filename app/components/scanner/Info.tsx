import {
  ArrowLeftIcon,
  CameraIcon,
  CheckCircleIcon,
  DevicePhoneMobileIcon,
  EyeIcon,
  HandRaisedIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

import { Eyebrow } from "~/components/ui";
import type { TextKey } from "~/lib/scanner-i18n";
import { useT } from "./lang";

export function ScreenFrame({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  const T = useT();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-white">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur-md">
        <button
          type="button"
          onClick={onBack}
          aria-label={T("back")}
          className="flex size-11 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <ArrowLeftIcon className="size-5" aria-hidden="true" />
        </button>
        <h1 className="text-gradient-brand text-lg font-bold tracking-tight">{title}</h1>
      </header>
      <div className="flex-1 space-y-8 px-5 py-6 pb-[max(2rem,env(safe-area-inset-bottom))]">{children}</div>
    </div>
  );
}

export function HowTo({ onBack }: { onBack: () => void }) {
  const T = useT();
  const steps: [TextKey, TextKey, typeof CameraIcon][] = [
    ["how1", "how1Text", CameraIcon],
    ["how2", "how2Text", EyeIcon],
    ["how3", "how3Text", HandRaisedIcon],
  ];
  const rules: TextKey[] = ["rule1", "rule2", "rule3", "rule4", "rule5"];
  return (
    <ScreenFrame title={T("howtoTitle")} onBack={onBack}>
      <ol className="space-y-5">
        {steps.map(([title, text, Icon], i) => (
          <li key={title} className="flex gap-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-brand-200 bg-brand-50 text-sm font-bold text-brand">{i + 1}</span>
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-semibold text-slate-900">
                <Icon className="size-4 text-brand" aria-hidden="true" />
                {T(title)}
              </p>
              <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{T(text)}</p>
            </div>
          </li>
        ))}
      </ol>

      <section>
        <Eyebrow>{T("legendTitle")}</Eyebrow>
        <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
          <Legend icon={CheckCircleIcon} tone="bg-emerald-600" text={T("legendGreen")} />
          <Legend icon={ExclamationTriangleIcon} tone="bg-amber-400 !text-slate-950" text={T("legendAmber")} />
          <Legend icon={XCircleIcon} tone="bg-red-600" text={T("legendRed")} />
        </ul>
      </section>

      <section>
        <Eyebrow>{T("rulesTitle")}</Eyebrow>
        <ul className="mt-3 space-y-3">
          {rules.map((r) => (
            <li key={r} className="flex gap-3 text-[15px] leading-relaxed text-slate-700">
              <ShieldCheckIcon className="mt-1 size-4 shrink-0 text-brand" aria-hidden="true" />
              <span>{T(r)}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-xs leading-relaxed text-slate-500">{T("supportFooter")}</p>
    </ScreenFrame>
  );
}

function Legend({ icon: Icon, tone, text }: { icon: typeof CameraIcon; tone: string; text: string }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-md text-white ${tone}`}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="text-[15px] leading-snug text-slate-700">{text}</span>
    </li>
  );
}

export function InstallGuide({ onBack, standalone }: { onBack: () => void; standalone: boolean }) {
  const T = useT();
  const groups: [TextKey, TextKey[]][] = [
    ["installIos", ["installIos1", "installIos2", "installIos3"]],
    ["installAndroid", ["installAndroid1", "installAndroid2"]],
  ];
  return (
    <ScreenFrame title={T("installTitle")} onBack={onBack}>
      {standalone ? (
        <p className="flex items-center gap-2 border-l-2 border-emerald-600 bg-emerald-50/70 px-4 py-3 text-sm font-medium text-emerald-950">
          <CheckCircleIcon className="size-5 text-emerald-600" aria-hidden="true" />
          {T("installStandalone")}
        </p>
      ) : null}
      <p className="text-[15px] leading-relaxed text-slate-600">{T("installIntro")}</p>
      {groups.map(([title, steps]) => (
        <section key={title}>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <DevicePhoneMobileIcon className="size-4 text-brand" aria-hidden="true" />
            {T(title)}
          </h2>
          <ol className="mt-3 space-y-3">
            {steps.map((s, i) => (
              <li key={s} className="flex gap-3 text-[15px] leading-relaxed text-slate-700">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-brand-200 bg-brand-50 text-xs font-bold text-brand">{i + 1}</span>
                <span className="pt-0.5">{T(s)}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </ScreenFrame>
  );
}
