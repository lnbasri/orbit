import { Outlet, data, isRouteErrorResponse, redirect } from "react-router";
import {
  BuildingOffice2Icon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import type { Route } from "./+types/layout";
import { adminAuthMethodContext, adminEmailContext, adminRoleContext } from "~/lib/admin-context";
import { ensureBootstrap, getAdmin, isAdmin, touchLogin } from "~/lib/admins.server";
import { identifyUser, isSameOrigin, loginPath } from "~/lib/auth.server";
import { featureEnabled, isDev } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";
import { AdminHeader, type AdminNavItem } from "~/components/AdminHeader";
import { Backdrop } from "~/components/ui";

// Every active ORBIT admin page and action passes through this check (fails closed):
// 1) identity = the app's own session cookie (PIN or Google login), 2) membership of the `admins` table.
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, url, context }, next) => {
    const env = getAppEnv();
    const path = url.pathname;
    const orbitPath =
      path === "/admin" ||
      /^\/admin\/members(?:\/(?:new|[A-Za-z0-9_-]+))?\/?$/.test(path) ||
      /^\/admin\/(?:households(?:\/[A-Za-z0-9_-]+)?|groups|admins)\/?$/.test(path);
    if (!orbitPath || !featureEnabled(env, "admin")) throw data("Not found.", { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
      throw data("Request denied.", { status: 403 });
    }
    await ensureBootstrap(env.DB, env.ADMIN_EMAILS);
    const result = await identifyUser(request, env);
    if (!result.ok) throw redirect(loginPath(url.pathname + url.search));

    // The session lookup already joins the admins table; this also covers the development bypass.
    if (!(await isAdmin(env.DB, result.email))) {
      throw data(`Access denied. ${result.email} is not an ORBIT administrator.`, { status: 403 });
    }
    const admin = await getAdmin(env.DB, result.email);
    if (!admin && result.method !== "dev") {
      throw data("Access denied.", { status: 403 });
    }
    if (path === "/admin/admins" && admin?.role !== "SUPER_ADMIN" && result.method !== "dev") {
      throw data("Only super administrators can manage administrator access.", { status: 403 });
    }
    await touchLogin(env.DB, result.email);
    context.set(adminEmailContext, result.email);
    context.set(adminAuthMethodContext, result.method);
    context.set(adminRoleContext, result.method === "dev" ? "dev" : (admin?.role ?? "ADMIN"));
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
  return [{ title: "ORBIT — Organisation Records & Business Intelligence Toolkit" }, { name: "robots", content: "noindex" }];
}

export function loader({ context }: Route.LoaderArgs) {
  const env = getAppEnv();
  return {
    email: context.get(adminEmailContext),
    canLogout: context.get(adminAuthMethodContext) !== "dev",
    dev: isDev(env),
  };
}

const NAV: AdminNavItem[] = [
  { to: "/admin", label: "Overview", icon: Squares2X2Icon, end: true },
  { to: "/admin/members", label: "Members", icon: UserGroupIcon, end: false },
  { to: "/admin/households", label: "Households", icon: BuildingOffice2Icon, end: false },
  { to: "/admin/groups", label: "Groups", icon: Squares2X2Icon, end: false },
  { to: "/admin/admins", label: "Access", icon: ShieldCheckIcon, end: false },
];

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <Backdrop>
      <div className="print:hidden">
        <AdminHeader items={NAV} email={loaderData.email} dev={loaderData.dev} canLogout={loaderData.canLogout} />
      </div>
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
      : "Something went wrong.";
  return (
    <Backdrop>
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
              {status ? `Error ${status}` : "Error"}
            </p>
            <h1 className="text-gradient-brand mt-1 text-2xl font-bold tracking-tight">ORBIT</h1>
          </div>
          <span className="flex size-11 items-center justify-center rounded-full border-2 border-brand font-semibold text-brand" aria-hidden="true">O</span>
        </div>
        <div className="mt-6 flex gap-3 border-l-2 border-red-600 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          <ExclamationTriangleIcon className="mt-px size-5 shrink-0 text-red-600" aria-hidden="true" />
          <p>{message}</p>
        </div>
      </main>
    </Backdrop>
  );
}
