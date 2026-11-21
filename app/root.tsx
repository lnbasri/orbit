import { data, isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { ArrowLeftIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import type { Route } from "./+types/root";
import "@fontsource-variable/inter/wght.css";
import "./app.css";
import { Backdrop, Eyebrow, Logo } from "~/components/ui";

// Inter is bundled with the app, so there are no third-party font requests.
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#034EA2" />
        <link rel="icon" href="/orbit-mark.svg" type="image/svg+xml" />
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

export const middleware: Route.MiddlewareFunction[] = [
  async ({ url }, next) => {
    if (url.pathname !== "/" && url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) {
      throw data("Not found.", { status: 404 });
    }
    return next();
  },
];

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong";
  let details = "Please try again in a moment.";
  let status: number | null = null;
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    message = error.status === 404 ? "Page not found" : "Something went wrong";
    details = typeof error.data === "string" ? error.data : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <Backdrop>
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10 sm:px-6 sm:py-16">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
          <Eyebrow>{status ? `Error ${status}` : "ORBIT"}</Eyebrow>
          <Logo className="h-10 w-auto sm:h-12" />
        </div>
        <div className="flex gap-4 pt-8">
          <ExclamationTriangleIcon className="mt-1 size-6 shrink-0 text-brand" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-gradient-brand text-2xl font-bold tracking-tight sm:text-3xl">{message}</h1>
            <p className="mt-3 leading-relaxed text-slate-600">{details}</p>
            <a
              href="/"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark"
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
              Back to ORBIT
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
