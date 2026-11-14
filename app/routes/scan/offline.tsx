import { SignalSlashIcon } from "@heroicons/react/24/outline";

import { Backdrop, Logo } from "~/components/ui";
import { scannerEnv } from "~/lib/scanner-guard.server";
import { t } from "~/lib/scanner-i18n";

export function meta() {
  return [{ title: "PPME Check-in" }, { name: "robots", content: "noindex" }];
}

/** Cached by the service worker and shown when a page cannot be loaded (check-in is online-only). Both languages, no personal data. */
export function loader() {
  scannerEnv();
  return null;
}

export default function Offline() {
  return (
    <Backdrop>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
        <div className="border border-slate-200/80 bg-white/85 backdrop-blur-md">
          <div className="h-1 bg-brand" aria-hidden="true" />
          <div className="space-y-6 px-6 py-8">
            <Logo className="h-10 w-auto" />
            <div className="flex gap-3">
              <SignalSlashIcon className="mt-1 size-6 shrink-0 text-brand" aria-hidden="true" />
              <div className="space-y-5">
                {(["id", "nl"] as const).map((l) => (
                  <div key={l}>
                    <h1 className="text-lg font-bold text-slate-900">{t(l, "offlineTitle")}</h1>
                    <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{t(l, "offlineText")}</p>
                  </div>
                ))}
              </div>
            </div>
            <a href="/scan" className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-6 text-[15px] font-semibold text-white">
              {t("id", "retry")} / {t("nl", "retry")}
            </a>
          </div>
        </div>
      </main>
    </Backdrop>
  );
}
