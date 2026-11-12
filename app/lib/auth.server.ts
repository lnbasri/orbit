import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * WHO is calling (identity only). WHETHER they may use /admin is decided separately against the
 * `admins` table (see admins.server.ts and the admin layout middleware).
 *
 * Production: Cloudflare Access sits in front of /admin and adds a signed JWT (`Cf-Access-Jwt-Assertion`).
 * We verify it against the team's public keys and the application audience and return the verified email.
 * Fails closed if Access is not configured.
 * Development: APP_ENV=development + DEV_ADMIN_EMAIL lets you use /admin locally without Access.
 */
export interface AuthEnv {
  APP_ENV?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_ADMIN_EMAIL?: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksDomain = "";

export type AuthResult = { ok: true; email: string } | { ok: false; status: 401 | 403; reason: string };

export async function identifyUser(request: Request, env: AuthEnv): Promise<AuthResult> {
  if (env.APP_ENV === "development" && env.DEV_ADMIN_EMAIL) {
    return { ok: true, email: env.DEV_ADMIN_EMAIL.toLowerCase() };
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return { ok: false, status: 403, reason: "Cloudflare Access belum dikonfigurasi." };
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, status: 401, reason: "Silakan login melalui Cloudflare Access." };

  const domain = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!jwks || jwksDomain !== domain) {
    jwks = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`));
    jwksDomain = domain;
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://${domain}`,
      audience: env.ACCESS_AUD,
    });
    const email = String(payload.email ?? "").toLowerCase();
    if (!email) return { ok: false, status: 403, reason: "Token tidak berisi email." };
    return { ok: true, email };
  } catch {
    return { ok: false, status: 401, reason: "Sesi Cloudflare Access tidak valid." };
  }
}
