import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { ArrowLeftIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import type { Route } from "./+types/root";
import "@fontsource-variable/inter/wght.css";
// Arabic greeting (Bismillah, salam): one bundled font so every device renders it the same. Arabic subset only.
import "@fontsource/noto-naskh-arabic/arabic-400.css";
import "./app.css";
import { Backdrop, Eyebrow, Logo } from "~/components/ui";

// No third-party fonts or trackers: Inter is bundled with the app, so the public form only talks to Turnstile.
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#034EA2" />
        <link rel="icon" href="/favicon.png" type="image/png" />
        <Meta />
        <Links />
      </head>
      <body className="bg-slate-50 font-sans text-slate-800 antialiased selection:bg-brand-100 selection:text-brand-dark">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Terjadi kesalahan";
  let details = "Silakan coba beberapa saat lagi.";
  let status: number | null = null;
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    message = error.status === 404 ? "Halaman tidak ditemukan" : "Terjadi kesalahan";
    details = typeof error.data === "string" ? error.data : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <Backdrop>
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10 sm:px-6 sm:py-16">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
          <Eyebrow>{status ? `Kode ${status}` : "PPME Den Haag"}</Eyebrow>
          <Logo className="h-10 w-auto sm:h-12" />
        </div>
        <div className="flex gap-4 pt-8">
          <ExclamationTriangleIcon className="mt-1 size-6 shrink-0 text-brand" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-gradient-brand text-2xl font-bold tracking-tight sm:text-3xl">{message}</h1>
            <p className="mt-3 leading-relaxed text-slate-600">{details}</p>
            <a
              href="https://www.ppmedenhaag.nl/"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark"
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
              Ke situs PPME Den Haag
            </a>
          </div>
        </div>
        {stack && (
          <pre className="mt-8 w-full overflow-x-auto border border-slate-800 bg-slate-950 p-4 text-xs text-slate-100">
            <code>{stack}</code>
          </pre>
        )}
      </main>
    </Backdrop>
  );
}
