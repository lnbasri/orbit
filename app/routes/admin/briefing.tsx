import { PrinterIcon } from "@heroicons/react/24/outline";

import type { Route } from "./+types/briefing";
import { PageHeader } from "~/components/admin";
import { buttonClass, Logo } from "~/components/ui";
import { PRACTICE_CODES, PRACTICE_SCENARIOS } from "~/lib/checkin.server";
import { getAppEnv } from "~/lib/env.server";
import { bytesToBase64 } from "~/lib/png";
import { qrPng } from "~/lib/qr";
import { t, type Lang, type TextKey } from "~/lib/scanner-i18n";
import { listContacts } from "~/lib/scanners.server";

export function meta() {
  return [{ title: "Lembar Briefing – PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

/** Printable briefing sheet: Indonesian page, then Dutch page. Contains the rules, the three colours, the escalation ladder and the practice QR codes. */
export async function loader() {
  const env = getAppEnv();
  const contacts = (await listContacts(env.DB, true)).filter((c) => c.active === 1);
  const practice = await Promise.all(
    PRACTICE_CODES.map(async (code) => ({
      code,
      qr: `data:image/png;base64,${bytesToBase64(await qrPng(code, { scale: 6 }))}`,
      scenario: PRACTICE_SCENARIOS[code],
    })),
  );
  return {
    contacts: contacts.map((c) => ({ id: c.id, level: c.level, name: c.name, role_label: c.role_label, phone: c.phone })),
    practice,
  };
}

const LEVEL_KEYS = { 1: "level1", 2: "level2", 3: "level3" } as const;
const HINT_KEYS = { 1: "level1Hint", 2: "level2Hint", 3: "level3Hint" } as const;
const REASONS = ["unknown_code", "ticket_revoked", "already_in", "not_accepted", "payment_unclear", "gate_before", "own_ticket"] as const;
const RULES: TextKey[] = ["rule1", "rule2", "rule3", "rule4", "rule5"];

export default function Briefing({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          back={{ to: "/admin/scanners", label: "Petugas scan" }}
          eyebrow="Hari-H"
          title="Lembar briefing"
          description="Cetak (Ctrl+P): satu halaman Bahasa Indonesia, satu halaman Bahasa Belanda, dengan kode QR latihan."
          actions={
            <button type="button" onClick={() => window.print()} className={buttonClass("primary", "md")}>
              <PrinterIcon className="size-4" aria-hidden="true" />
              Cetak
            </button>
          }
        />
      </div>
      <div className="space-y-8 print:space-y-0">
        {(["id", "nl"] as Lang[]).map((lang) => (
          <Sheet key={lang} lang={lang} data={loaderData} />
        ))}
      </div>
    </div>
  );
}

function Sheet({ lang, data }: { lang: Lang; data: Route.ComponentProps["loaderData"] }) {
  const T = (key: TextKey, vars?: Record<string, string | number>) => t(lang, key, vars);
  return (
    <article className="border border-slate-200/80 bg-white p-6 text-slate-900 sm:p-8 print:break-after-page print:border-0 print:p-0">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-brand uppercase">Kajian PPME Den Haag · {lang === "id" ? "Bahasa Indonesia" : "Nederlands"}</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">{lang === "id" ? "Lembar briefing petugas check-in" : "Briefingblad check-in medewerkers"}</h2>
        </div>
        <Logo className="h-10 w-auto" />
      </header>

      <div className="mt-5 grid gap-6 md:grid-cols-2 print:grid-cols-2">
        <section>
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">{T("how1")} · {T("how2")} · {T("how3")}</h3>
          <ol className="mt-2 space-y-1.5 text-sm leading-snug">
            <li>1. {T("how1Text")}</li>
            <li>2. {T("how2Text")}</li>
            <li>3. {T("how3Text")}</li>
          </ol>

          <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-slate-500">{T("legendTitle")}</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            <li className="border-l-4 border-emerald-600 pl-3">{T("legendGreen")}</li>
            <li className="border-l-4 border-amber-400 pl-3">{T("legendAmber")}</li>
            <li className="border-l-4 border-red-600 pl-3">{T("legendRed")}</li>
          </ul>

          <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-slate-500">{T("rulesTitle")}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-snug">
            {RULES.map((r) => (
              <li key={r}>{T(r)}</li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">{T("helpTitle")}</h3>
          <p className="mt-2 text-sm">{T("supportFooter")}</p>
          <ol className="mt-3 space-y-2 text-sm">
            {([1, 2, 3] as const).map((level) => {
              const list = data.contacts.filter((c) => c.level === level);
              return (
                <li key={level} className="border border-slate-300 p-2.5">
                  <p className="font-semibold">
                    {level}. {T(LEVEL_KEYS[level])}
                  </p>
                  <p className="text-xs text-slate-600">{T(HINT_KEYS[level])}</p>
                  <p className="mt-1 text-sm">
                    {list.length === 0 ? <span className="text-slate-400">{T("noContacts")}</span> : list.map((c) => `${c.name}${c.role_label ? ` (${c.role_label})` : ""}: ${c.phone}`).join(" · ")}
                  </p>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 border-l-4 border-red-600 pl-3 text-sm font-semibold">{T("unsafe")}</p>

          <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-slate-500">{T("sayTitle")}</h3>
          <p className="mt-2 text-sm italic">&ldquo;{T("sayGuest")}&rdquo;</p>
        </section>
      </div>

      <section className="mt-6">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">{T("mPractice")} (PPME-LATIHAN)</h3>
        <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5 print:grid-cols-5">
          {data.practice.map((p) => (
            <li key={p.code} className="border border-slate-300 p-2 text-center">
              <img src={p.qr} alt={p.code} className="mx-auto size-24" />
              <p className="mt-1 font-mono text-[10px] font-semibold">{p.code.replace("PPME-", "")}</p>
              <p className="text-[10px] leading-tight text-slate-600">{p.scenario[lang]}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          {REASONS.map((r) => `${T(`r_${r}` as TextKey)}: ${T(`a_${r}` as TextKey)}`).join(" ")}
        </p>
      </section>
    </article>
  );
}
