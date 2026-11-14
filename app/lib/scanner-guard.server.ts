import { data, redirect } from "react-router";

import { checkinEnabled, type AppEnv } from "./config.server";
import { getEventBySlug, type EventRow } from "./db.server";
import { getAppEnv } from "./env.server";
import { isSameOrigin } from "./auth.server";
import type { ScannerIdentity } from "./checkin.server";
import { identifyScanner } from "./scanner-auth.server";

/** 404 unless this Worker serves the scanner app (ENABLE_CHECKIN="true"; always on in local development). */
export function scannerEnv(): AppEnv {
  const env = getAppEnv();
  if (!checkinEnabled(env)) throw data("Not found.", { status: 404 });
  return env;
}

export async function loadScannerEvent(env: AppEnv): Promise<EventRow> {
  const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG || "kajian-aisah-dahlan-2026");
  if (!event) throw data("Event not found.", { status: 404 });
  return event;
}

/** A scanner page: no valid session means the login page (fails closed). */
export async function requireScannerPage(request: Request) {
  const env = scannerEnv();
  const scanner = await identifyScanner(request, env);
  if (!scanner) throw redirect("/scan/login");
  return { env, scanner };
}

const NO_STORE = { "Cache-Control": "private, no-store" };

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

/** API calls: JSON only, same origin for POST, scanner session required. Returns a Response to send when the call is refused. */
export async function requireScannerApi(
  request: Request,
): Promise<{ env: AppEnv; scanner: ScannerIdentity; event: EventRow } | Response> {
  const env = getAppEnv();
  if (!checkinEnabled(env)) return json({ error: "not_found" }, 404);
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  const scanner = await identifyScanner(request, env);
  if (!scanner) return json({ error: "session" }, 401);
  const event = await loadScannerEvent(env).catch(() => null);
  if (!event) return json({ error: "no_event" }, 404);
  return { env, scanner, event };
}
