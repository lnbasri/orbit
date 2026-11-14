import { data, redirect } from "react-router";

import type { Route } from "./+types/logout";
import { isSameOrigin } from "~/lib/auth.server";
import { clearScannerSessionCookie, destroyScannerSession } from "~/lib/scanner-auth.server";
import { scannerEnv } from "~/lib/scanner-guard.server";

export function loader() {
  scannerEnv();
  return redirect("/scan");
}

export async function action({ request }: Route.ActionArgs) {
  const env = scannerEnv();
  if (!isSameOrigin(request)) throw data("Forbidden.", { status: 403 });
  await destroyScannerSession(env.DB, request);
  throw redirect("/scan/login?out", { headers: { "Set-Cookie": clearScannerSessionCookie(request) } });
}
