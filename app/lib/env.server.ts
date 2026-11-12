import { env } from "cloudflare:workers";
import type { AppEnv } from "./config.server";

/** Worker bindings/vars. Call inside loaders/actions only (never at module level of a route). */
export function getAppEnv(): AppEnv {
  return env as unknown as AppEnv;
}
