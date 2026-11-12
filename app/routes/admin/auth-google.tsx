import { data } from "react-router";

import type { Route } from "./+types/auth-google";
import { featureEnabled } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";
import { googleConfig, startGoogleLogin } from "~/lib/google-oauth.server";

// GET /admin/auth/google?next=/admin/... -> Google consent screen. 404 until GOOGLE_CLIENT_ID/SECRET are set.
export async function loader({ request, url }: Route.LoaderArgs) {
  const env = getAppEnv();
  const cfg = googleConfig(env);
  if (!featureEnabled(env, "admin") || !cfg) throw data("Tidak ditemukan.", { status: 404 });
  return startGoogleLogin(request, cfg, url.searchParams.get("next"));
}
