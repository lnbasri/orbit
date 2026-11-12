import { Outlet, data, isRouteErrorResponse, redirect } from "react-router";
import {
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  InboxIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";

import type { Route } from "./+types/layout";
import { adminAuthMethodContext, adminEmailContext } from "~/lib/admin-context";
import { ensureBootstrap, isAdmin, touchLogin } from "~/lib/admins.server";
import { identifyUser, isSameOrigin, loginPath } from "~/lib/auth.server";
import { featureEnabled, isDev } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";
import { AdminHeader, type AdminNavItem } from "~/components/AdminHeader";
import { Backdrop } from "~/components/ui";

// Every /admin route (pages, actions, CSV export) passes through this check (fails closed):
// 1) identity = the app's own session cookie (PIN or Google login), 2) membership of the `admins` table.
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, url, context }, next) => {
    const env = getAppEnv();
    if (!featureEnabled(env, "admin")) throw data("Tidak ditemukan.", { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
      throw data("Permintaan ditolak.", { status: 403 });
    }
    await ensureBootstrap(env.DB, env.ADMIN_EMAILS);
    const result = await identifyUser(request, env);
    if (!result.ok) throw redirect(loginPath(url.pathname + url.search));

    // The session lookup already joins the admins table; this also covers the development bypass.
    if (!(await isAdmin(env.DB, result.email))) {
      throw data(`Akses ditolak. ${result.email} bukan admin panitia.`, { status: 403 });
    }
    await touchLogin(env.DB, result.email);
    context.set(adminEmailContext, result.email);
    context.set(adminAuthMethodContext, result.method);
    const response = await next();
    // Admin pages hold personal data: never cache them in shared or browser caches.
    if (response instanceof Response) {
      try {
        response.headers.set("Cache-Control", "private, no-store");
      } catch {
        // immutable headers (e.g. Response.redirect): nothing to cache anyway
      }
    }
    return response;
  },
];

export function meta() {
  return [{ title: "Dashboard Panitia – PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

export function loader({ context }: Route.LoaderArgs) {
  const env = getAppEnv();
  return {
    email: context.get(adminEmailContext),
    canLogout: context.get(adminAuthMethodContext) !== "dev",
    dev: isDev(env),
    outbox: env.EMAIL_MODE !== "resend",
  };
}

const NAV: AdminNavItem[] = [
  { to: "/admin", label: "Ringkasan", icon: Squares2X2Icon, end: true },
  { to: "/admin/registrations", label: "Pendaftaran", icon: ClipboardDocumentListIcon, end: false },
  { to: "/admin/settings", label: "Pengaturan", icon: Cog6ToothIcon, end: false },
  { to: "/admin/admins", label: "Admin", icon: ShieldCheckIcon, end: false },
];

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const items = loaderData.outbox
    ? [...NAV, { to: "/admin/outbox", label: "Outbox email", icon: InboxIcon, end: false }]
    : NAV;
  return (
    <Backdrop>
      <AdminHeader items={items} email={loaderData.email} dev={loaderData.dev} canLogout={loaderData.canLogout} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </Backdrop>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : null;
  const message = isRouteErrorResponse(error)
    ? typeof error.data === "string"
      ? error.data
      : error.statusText
    : error instanceof Error
      ? error.message
      : "Terjadi kesalahan.";
  return (
    <Backdrop>
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
              {status ? `Kode ${status}` : "Kesalahan"}
            </p>
            <h1 className="text-gradient-brand mt-1 text-2xl font-bold tracking-tight">Dashboard Panitia</h1>
          </div>
          <img src="/logo-ppme.png" alt="PPME Den Haag" width={135} height={70} className="h-10 w-auto" />
        </div>
        <div className="mt-6 flex gap-3 border-l-2 border-red-600 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          <ExclamationTriangleIcon className="mt-px size-5 shrink-0 text-red-600" aria-hidden="true" />
          <p>{message}</p>
        </div>
      </main>
    </Backdrop>
  );
}
