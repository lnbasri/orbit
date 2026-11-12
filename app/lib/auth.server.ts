import { auditStatement } from "./db.server";
import { normalizeEmail } from "./admins.server";

/**
 * WHO is calling (identity). The app owns admin login: after a one-time PIN (login-codes.server.ts) or Google
 * sign-in (google-oauth.server.ts) succeeds, we issue a random session token in an HttpOnly cookie and keep only
 * its SHA-256 in `admin_sessions`. Sessions last 24 hours (absolute, no sliding renewal).
 *
 * WHETHER the caller may use /admin is the `admins` table: the session lookup joins it, so removing an admin
 * ends their access on the next request (removeAdmin also deletes their sessions). Fails closed: no valid cookie = no access.
 * Development: APP_ENV=development + DEV_ADMIN_EMAIL skips login entirely (leave it empty to test the real flow).
 */
export interface AuthEnv {
  APP_ENV?: string;
  DEV_ADMIN_EMAIL?: string;
}

export type AuthMethod = "pin" | "google";
export type AuthResult = { ok: true; email: string; method: AuthMethod | "dev" } | { ok: false };

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const COOKIE_SECURE = "__Host-ppme_admin";
/** Plain-http development (localhost) cannot use the __Host- prefix, which requires Secure. */
const COOKIE_INSECURE = "ppme_admin";

// ---------------------------------------------------------------- crypto helpers

const encoder = new TextEncoder();

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** URL-safe random string with `bytes` bytes of entropy (default 256 bits). */
export function randomToken(bytes = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function sha256Hex(value: string): Promise<string> {
  return [...(await sha256(value))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare two strings without an early exit on the first difference. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- cookies

export function isSecureRequest(request: Request) {
  return new URL(request.url).protocol === "https:";
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Set-Cookie value. Secure (https) cookies are host-only, SameSite=Lax, HttpOnly. */
export function serializeCookie(name: string, value: string, opts: { maxAge: number; secure: boolean; path?: string }) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? "/"}`,
    `Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`,
    "HttpOnly",
    "SameSite=Lax",
    opts.secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

const sessionCookieName = (secure: boolean) => (secure ? COOKIE_SECURE : COOKIE_INSECURE);

export function sessionCookie(request: Request, token: string) {
  const secure = isSecureRequest(request);
  return serializeCookie(sessionCookieName(secure), token, { maxAge: SESSION_TTL_MS / 1000, secure });
}

export function clearSessionCookie(request: Request) {
  const secure = isSecureRequest(request);
  return serializeCookie(sessionCookieName(secure), "", { maxAge: 0, secure });
}

// ---------------------------------------------------------------- request helpers

export function clientIp(request: Request): string | null {
  return request.headers.get("CF-Connecting-IP");
}

export function requestMeta(request: Request) {
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  return {
    ip: clientIp(request),
    userAgent: request.headers.get("User-Agent")?.slice(0, 300) ?? null,
    country: typeof cf?.country === "string" ? cf.country : null,
  };
}
export type RequestMeta = ReturnType<typeof requestMeta>;

/**
 * Browsers send Origin on every POST. A cross-site form post is rejected (login CSRF / admin actions); SameSite=Lax
 * already keeps the session cookie off such requests, this is the second layer.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

/** Only relative /admin paths are allowed as post-login destinations (no open redirect, no login loops). */
export function safeNextPath(raw: string | null | undefined): string {
  const fallback = "/admin";
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  try {
    const base = "https://next.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) return fallback;
    if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) return fallback;
    if (/^\/admin\/(login|logout|auth)(\/|$)/.test(url.pathname)) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}

export function loginPath(next?: string) {
  const target = safeNextPath(next);
  return target === "/admin" ? "/admin/login" : `/admin/login?next=${encodeURIComponent(target)}`;
}

// ---------------------------------------------------------------- sessions

/**
 * Start a session for an admin. Returns null when the email is not (or no longer) in the admins table.
 * Also records the login in the audit log and clears expired sessions/codes (keeps the tables small without a cron).
 */
export async function createSession(
  db: D1Database,
  emailRaw: string,
  method: AuthMethod,
  meta: Pick<RequestMeta, "ip" | "userAgent">,
  now = new Date(),
): Promise<{ token: string; expiresAt: string } | null> {
  const email = normalizeEmail(emailRaw);
  const token = randomToken();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO admin_sessions (token_hash, email, method, created_at, expires_at, ip, user_agent)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admins WHERE email = ?)`,
      )
      .bind(await sha256Hex(token), email, method, nowIso, expiresAt, meta.ip, meta.userAgent, email),
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(nowIso),
    db
      .prepare("DELETE FROM admin_login_codes WHERE created_at <= ?")
      .bind(new Date(now.getTime() - SESSION_TTL_MS).toISOString()),
  ]);
  if ((insert.meta.changes ?? 0) !== 1) return null;
  await auditStatement(db, email, "auth.login", null, { method }, nowIso).run();
  return { token, expiresAt };
}

async function sessionTokenHash(request: Request): Promise<string | null> {
  const token = readCookie(request, sessionCookieName(isSecureRequest(request)));
  if (!token || token.length < 32 || token.length > 128) return null;
  return sha256Hex(token);
}

/** Identity of the caller: a live session whose email is still in the admins table. */
export async function identifyUser(
  request: Request,
  env: AuthEnv & { DB: D1Database },
  now = new Date(),
): Promise<AuthResult> {
  if (env.APP_ENV === "development" && env.DEV_ADMIN_EMAIL) {
    return { ok: true, email: normalizeEmail(env.DEV_ADMIN_EMAIL), method: "dev" };
  }
  const hash = await sessionTokenHash(request);
  if (!hash) return { ok: false };
  const row = await env.DB.prepare(
    `SELECT s.email, s.method FROM admin_sessions s JOIN admins a ON a.email = s.email
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(hash, now.toISOString())
    .first<{ email: string; method: AuthMethod }>();
  return row ? { ok: true, email: row.email, method: row.method } : { ok: false };
}

/** Delete the caller's session (logout). Safe to call without a session. */
export async function destroySession(db: D1Database, request: Request, now = new Date()) {
  const hash = await sessionTokenHash(request);
  if (!hash) return;
  const row = await db
    .prepare("DELETE FROM admin_sessions WHERE token_hash = ? RETURNING email")
    .bind(hash)
    .first<{ email: string }>();
  if (row) await auditStatement(db, row.email, "auth.logout", null, undefined, now.toISOString()).run();
}
