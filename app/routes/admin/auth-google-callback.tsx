import { data, redirect } from "react-router";

import type { Route } from "./+types/auth-google-callback";
import { ensureBootstrap } from "~/lib/admins.server";
import { createSession, requestMeta, sessionCookie } from "~/lib/auth.server";
import { featureEnabled } from "~/lib/config.server";
import { auditStatement } from "~/lib/db.server";
import { getAppEnv } from "~/lib/env.server";
import { clearFlowCookie, finishGoogleLogin, googleConfig } from "~/lib/google-oauth.server";

// Google redirects here. A verified Google email still needs a row in the admins table, same as the PIN login.
export async function loader({ request, url }: Route.LoaderArgs) {
  const env = getAppEnv();
  const cfg = googleConfig(env);
  if (!featureEnabled(env, "admin") || !cfg) throw data("Not found.", { status: 404 });

  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearFlowCookie(request));

  const result = await finishGoogleLogin(request, url, cfg);
  if (!result.ok) return redirect(`/admin/login?error=google_${result.error}`, { headers });

  await ensureBootstrap(env.DB, env.ADMIN_EMAILS);
  const session = await createSession(env.DB, result.email, "google", requestMeta(request));
  if (!session) {
    await auditStatement(env.DB, result.email, "auth.google_denied", null, undefined, new Date().toISOString()).run();
    return redirect("/admin/login?error=google_not_admin", { headers });
  }
  headers.append("Set-Cookie", sessionCookie(request, session.token));
  return redirect(result.next, { headers });
}
