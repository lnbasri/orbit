/** Settings read from Worker vars/secrets. Kept in one place so routes, cron and tests agree. */
export interface AppEnv {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  APP_ENV?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  EMAIL_MODE?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  ENABLE_EMAIL_DELIVERY?: string;
  PUBLIC_APP_URL?: string;
  /** Seed list for the admins table (first run only). */
  ADMIN_EMAILS?: string;
  /** Optional Google sign-in on /admin/login: both must be set (client id = var, secret = `wrangler secret put`). */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Development only: skip the admin login and act as this admin. */
  DEV_ADMIN_EMAIL?: string;
  ENABLE_PUBLIC?: string;
  ENABLE_ADMIN?: string;
}

export function featureEnabled(env: Pick<AppEnv, "ENABLE_PUBLIC" | "ENABLE_ADMIN">, feature: "public" | "admin") {
  return (feature === "public" ? env.ENABLE_PUBLIC : env.ENABLE_ADMIN)?.trim().toLowerCase() !== "false";
}

export function isDev(env: AppEnv) {
  return env.APP_ENV === "development";
}

export function emailDeliveryEnabled(env: Pick<AppEnv, "ENABLE_EMAIL_DELIVERY">) {
  return env.ENABLE_EMAIL_DELIVERY?.trim().toLowerCase() === "true";
}

export function emailDeliveryReady(
  env: Pick<AppEnv, "ENABLE_EMAIL_DELIVERY" | "EMAIL_MODE" | "RESEND_API_KEY" | "PUBLIC_APP_URL"> &
    Pick<AppEnv, "EMAIL_FROM" | "EMAIL_REPLY_TO">,
) {
  const config = emailConfig(env);
  if (!emailDeliveryEnabled(env) || config.mode !== "resend" || !config.resendApiKey || !config.publicUrl) return false;
  try {
    const publicUrl = new URL(config.publicUrl);
    return publicUrl.protocol === "https:" && publicUrl.pathname === "/" && !publicUrl.search && !publicUrl.hash;
  } catch {
    return false;
  }
}

export interface OrbitEmailConfig {
  mode: "log" | "resend";
  from: string;
  replyTo: string;
  resendApiKey?: string;
  publicUrl?: string;
}

export function emailConfig(
  env: Pick<AppEnv, "EMAIL_MODE" | "EMAIL_FROM" | "EMAIL_REPLY_TO" | "RESEND_API_KEY" | "PUBLIC_APP_URL">,
): OrbitEmailConfig {
  return {
    mode: env.EMAIL_MODE === "resend" ? "resend" : "log",
    from: env.EMAIL_FROM ?? "ORBIT <no-reply@example.com>",
    replyTo: env.EMAIL_REPLY_TO ?? "no-reply@example.com",
    resendApiKey: env.RESEND_API_KEY,
    publicUrl: env.PUBLIC_APP_URL?.trim().replace(/\/$/, "") || undefined,
  };
}
