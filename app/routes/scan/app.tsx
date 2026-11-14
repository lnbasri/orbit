import { useEffect } from "react";
import { data } from "react-router";

import type { Route } from "./+types/app";
import { LangProvider } from "~/components/scanner/lang";
import { ScannerApp } from "~/components/scanner/ScannerApp";
import { listContacts } from "~/lib/scanners.server";
import { detectLang } from "~/lib/scanner-i18n";
import { loadScannerEvent, requireScannerPage } from "~/lib/scanner-guard.server";

export function meta() {
  return [
    { title: "PPME Check-in" },
    { name: "robots", content: "noindex, nofollow" },
    { name: "mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-title", content: "Check-in" },
    { name: "apple-mobile-web-app-status-bar-style", content: "default" },
    { name: "format-detection", content: "telephone=no" },
  ];
}

export function links() {
  return [
    { rel: "manifest", href: "/scan/manifest.webmanifest" },
    { rel: "apple-touch-icon", href: "/scan-icons/apple-touch-icon.png" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { env, scanner } = await requireScannerPage(request);
  await loadScannerEvent(env);
  const contacts = await listContacts(env.DB, true);
  // Names and contacts: never cached by the browser or a proxy.
  return data(
    {
      lang: detectLang(request.headers.get("Cookie"), request.headers.get("Accept-Language")),
      scanner: { name: scanner.name, email: scanner.email, role: scanner.role },
      contacts: contacts.map((c) => ({ id: c.id, level: c.level, name: c.name, role_label: c.role_label, phone: c.phone, note: c.note })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export default function ScanRoute({ loaderData }: Route.ComponentProps) {
  const { lang, scanner, contacts } = loaderData;
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <LangProvider lang={lang}>
      <ScannerApp scanner={scanner} contacts={contacts} />
    </LangProvider>
  );
}
