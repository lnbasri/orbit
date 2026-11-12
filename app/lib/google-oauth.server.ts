import { createRemoteJWKSet, jwtVerify } from "jose";

import {
  bytesToBase64Url,
  isSecureRequest,
  randomToken,
  readCookie,
  safeNextPath,
  serializeCookie,
  sha256,
  timingSafeEqual,
} from "./auth.server";

/**
 * Optional "Masuk dengan Google" for /admin (OpenID Connect, authorization-code flow with PKCE + state + nonce).
 * Turned on by setting GOOGLE_CLIENT_ID (var) and GOOGLE_CLIENT_SECRET (secret) on the admin Worker; the login
 * page shows the button only then. Google proves the email; the admins table still decides access, exactly as
 * for the PIN. Authorised redirect URI to register in Google Cloud: <admin origin>/admin/auth/google/callback
 */
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export function googleConfig(env: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string }): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const FLOW_COOKIE = "ppme_oauth";
const FLOW_TTL_S = 600;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const googleKeys = () => (jwks ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")));

interface FlowState {
  state: string;
  verifier: string;
  nonce: string;
  next: string;
}

export const redirectUri = (request: Request) => `${new URL(request.url).origin}/admin/auth/google/callback`;

const flowCookie = (request: Request, value: string, maxAge: number) =>
  serializeCookie(FLOW_COOKIE, value, { maxAge, secure: isSecureRequest(request), path: "/admin/auth/google" });

/** Redirect to Google's consent screen; the PKCE verifier, state and nonce wait in a 10-minute HttpOnly cookie. */
export async function startGoogleLogin(request: Request, cfg: GoogleConfig, nextRaw: string | null): Promise<Response> {
  const flow: FlowState = {
    state: randomToken(16),
    verifier: randomToken(32),
    nonce: randomToken(16),
    next: safeNextPath(nextRaw),
  };
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: "openid email",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: bytesToBase64Url(await sha256(flow.verifier)),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  const headers = new Headers({ Location: url.toString(), "Cache-Control": "no-store" });
  headers.append("Set-Cookie", flowCookie(request, btoa(JSON.stringify(flow)), FLOW_TTL_S));
  return new Response(null, { status: 302, headers });
}

export type GoogleResult =
  | { ok: true; email: string; next: string }
  | { ok: false; error: "cancelled" | "state" | "exchange" | "token" | "unverified" };

/** Header that removes the flow cookie (send it with every callback response). */
export const clearFlowCookie = (request: Request) => flowCookie(request, "", 0);

/** Validate the callback: state, code exchange, ID token signature/issuer/audience/expiry, nonce, verified email. */
export async function finishGoogleLogin(
  request: Request,
  url: URL,
  cfg: GoogleConfig,
  fetcher: typeof fetch = fetch,
): Promise<GoogleResult> {
  let flow: FlowState;
  try {
    flow = JSON.parse(atob(readCookie(request, FLOW_COOKIE) ?? "")) as FlowState;
  } catch {
    return { ok: false, error: "state" };
  }
  if (url.searchParams.get("error")) return { ok: false, error: "cancelled" };
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (!flow?.state || !code || !timingSafeEqual(state, flow.state)) return { ok: false, error: "state" };

  const res = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri(request),
      code_verifier: flow.verifier,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) {
    console.error(`google token exchange failed: ${res.status} ${body.error ?? ""}`);
    return { ok: false, error: "exchange" };
  }

  try {
    const { payload } = await jwtVerify(body.id_token, googleKeys(), { issuer: ISSUERS, audience: cfg.clientId });
    if (payload.nonce !== flow.nonce) return { ok: false, error: "token" };
    if (payload.email_verified !== true || typeof payload.email !== "string") return { ok: false, error: "unverified" };
    return { ok: true, email: payload.email.toLowerCase(), next: safeNextPath(flow.next) };
  } catch (err) {
    console.error(`google id_token rejected: ${(err as Error)?.message}`);
    return { ok: false, error: "token" };
  }
}
