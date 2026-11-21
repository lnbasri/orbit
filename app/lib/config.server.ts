/** Settings read from Worker vars/secrets. Kept in one place so routes, cron and tests agree. */
export interface AppEnv {
  DB: D1Database;
  APP_ENV?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  EMAIL_MODE?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  RESEND_API_KEY?: string;
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

export interface OrbitEmailConfig {
  mode: "log" | "resend";
  from: string;
  replyTo: string;
  resendApiKey?: string;
  publicUrl?: string;
}

export function emailConfig(env: AppEnv): OrbitEmailConfig {
  return {
    mode: env.EMAIL_MODE === "resend" ? "resend" : "log",
    from: env.EMAIL_FROM ?? "ORBIT <no-reply@example.com>",
    replyTo: env.EMAIL_REPLY_TO ?? "no-reply@example.com",
    resendApiKey: env.RESEND_API_KEY,
    publicUrl: env.PUBLIC_APP_URL?.trim().replace(/\/$/, "") || undefined,
  };
}
