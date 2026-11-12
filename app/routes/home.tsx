import { data, redirect } from "react-router";
import { featureEnabled } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";

export function loader() {
  const env = getAppEnv();
  if (!featureEnabled(env, "public")) {
    // Admin-only Worker: the root goes to the admin area.
    if (featureEnabled(env, "admin")) return redirect("/admin");
    throw data("Tidak ditemukan.", { status: 404 });
  }
  return redirect(`/e/${env.DEFAULT_EVENT_SLUG || "kajian-aisah-dahlan-2026"}`);
}
