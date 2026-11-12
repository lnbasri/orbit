import { Outlet, data, isRouteErrorResponse } from "react-router";
import {
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  InboxIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";

import type { Route } from "./+types/layout";
import { adminEmailContext } from "~/lib/admin-context";
import { ensureBootstrap, isAdmin, touchLogin } from "~/lib/admins.server";
import { identifyUser } from "~/lib/auth.server";
import { featureEnabled, isDev } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";
import { AdminHeader, type AdminNavItem } from "~/components/AdminHeader";
import { Backdrop } from "~/components/ui";

// Every /admin route (pages, actions, CSV export) passes through this check:
// 1) identity from Cloudflare Access, 2) membership of the `admins` table (fails closed).
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    const env = getAppEnv();
    if (!featureEnabled(env, "admin")) throw data("Tidak ditemukan.", { status: 404 });
    const result = await identifyUser(request, env);
    if (!result.ok) throw data(result.reason, { status: result.status });

    await ensureBootstrap(env.DB, env.ADMIN_EMAILS);
    if (!(await isAdmin(env.DB, result.email))) {
      throw data(`Akses ditolak. ${result.email} bukan admin panitia.`, { status: 403 });
    }
    await touchLogin(env.DB, result.email);
    context.set(adminEmailContext, result.email);
    return next();
  },
];

export function meta() {
  return [{ title: "Dashboard Panitia – PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

export function loader({ context }: Route.LoaderArgs) {
  const env = getAppEnv();
  return {
    email: context.get(adminEmailContext),
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
      <AdminHeader items={items} email={loaderData.email} dev={loaderData.dev} />
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
