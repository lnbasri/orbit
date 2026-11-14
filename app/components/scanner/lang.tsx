import { createContext, useCallback, useContext } from "react";
import { useRevalidator } from "react-router";

import { LANG_COOKIE, LANGS, t, type Lang, type TextKey, type Vars } from "~/lib/scanner-i18n";

const LangContext = createContext<Lang>("id");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

/** Translate with the current language: `const T = useT(); T("scanHint")`. */
export function useT() {
  const lang = useLang();
  return useCallback((key: TextKey, vars?: Vars) => t(lang, key, vars), [lang]);
}

/** Time of day in Europe/Amsterdam, e.g. "08:52" (check-in times are always shown in Dutch time). */
export function clock(iso: string): string {
  return new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso),
  );
}

/** ID | NL switch. The choice is a cookie (so the server renders the right language at once) and the page reloads its data. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const lang = useLang();
  const { revalidate } = useRevalidator();

  function choose(next: Lang) {
    if (next === lang) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LANG_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    document.documentElement.lang = next;
    void revalidate();
  }

  return (
    <div role="group" aria-label={t(lang, "language")} className={`inline-flex overflow-hidden rounded-md border border-slate-300 bg-white text-xs font-semibold ${className}`}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => choose(l)}
          aria-pressed={l === lang}
          className={`min-h-9 px-3 uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${
            l === lang ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
