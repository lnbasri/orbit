import { data, redirect } from "react-router";

import type { Route } from "./+types/logout";
import { clearSessionCookie, destroySession, isSameOrigin } from "~/lib/auth.server";
import { featureEnabled } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";

// Logout is POST only (a GET link could be triggered cross-site); a GET just goes back to the dashboard.
export function loader() {
  return redirect("/admin");
}

export async function action({ request }: Route.ActionArgs) {
  const env = getAppEnv();
  if (!featureEnabled(env, "admin")) throw data("Tidak ditemukan.", { status: 404 });
  if (!isSameOrigin(request)) throw data("Permintaan ditolak.", { status: 403 });
  await destroySession(env.DB, request);
  return redirect("/admin/login?out=1", { headers: { "Set-Cookie": clearSessionCookie(request) } });
}
