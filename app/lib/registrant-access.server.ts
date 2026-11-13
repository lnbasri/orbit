import { normalizeEmail } from "./admins.server";
import {
  isSecureRequest,
  randomToken,
  readCookie,
  serializeCookie,
  sha256Hex,
  timingSafeEqual,
  type RequestMeta,
} from "./auth.server";
import { auditStatement, type EventRow } from "./db.server";
import { loginCodeEmail } from "./email/login-code";
import { sendDirectEmail, type EmailConfig } from "./email/send.server";
import {
  CODE_COOLDOWN_MS,
  CODE_MAX_ATTEMPTS,
  CODE_MAX_PER_HOUR,
  CODE_TTL_MS,
  generateCode,
  hashCode,
  isValidEmail,
  normalizeCode,
  type RequestCodeResult,
  type VerifyCodeResult,
} from "./login-codes.server";

/**
 * Registrant access to "Pendaftaran saya" (/e/<slug>/pendaftaran-saya). Same PIN design as the admin login
 * (login-codes.server.ts): 6 digits, 10 minutes, 5 attempts, newest code only, 1/min + 5/h per email, every request
 * behind Turnstile (checked by the route). Differences:
 *  - scoped to one event: a code is only issued when that email has an ACTIVE registration (accepted / pending_payment)
 *    for the event; otherwise nothing is sent and the answer is the same (no registration enumeration);
 *  - own tables (registrant_login_codes / registrant_sessions) and own cookie, so a registrant session can never be
 *    mistaken for an admin session;
 *  - sessions last 2 hours (absolute).
 */
export const REGISTRANT_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const COOKIE_SECURE = "__Host-ppme_reg";
const COOKIE_INSECURE = "ppme_reg";
const cookieName = (secure: boolean) => (secure ? COOKIE_SECURE : COOKIE_INSECURE);

export const ACTIVE_REGISTRATION_SQL = `SELECT 1 FROM registrations
  WHERE event_id = ?1 AND lower(email) = ?2 AND status IN ('accepted', 'pending_payment')`;

export const registrantPath = (slug: string) => `/e/${slug}/pendaftaran-saya`;

export async function requestRegistrantCode(
  db: D1Database,
  cfg: EmailConfig,
  event: Pick<EventRow, "id" | "slug" | "title">,
  emailRaw: string,
  meta: RequestMeta & { appOrigin: string },
  now = new Date(),
): Promise<RequestCodeResult> {
  const email = normalizeEmail(emailRaw);
  if (!isValidEmail(email)) return { status: "skipped" };

  const code = generateCode();
  const salt = crypto.randomUUID();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();

  // Eligibility and rate limits are part of the INSERT, so parallel requests cannot bypass them.
  const row = await db
    .prepare(
      `INSERT INTO registrant_login_codes (event_id, email, code_hash, salt, created_at, expires_at, ip)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
       WHERE EXISTS (${ACTIVE_REGISTRATION_SQL})
         AND NOT EXISTS (SELECT 1 FROM registrant_login_codes WHERE event_id = ?1 AND email = ?2 AND created_at > ?8)
         AND (SELECT COUNT(*) FROM registrant_login_codes WHERE event_id = ?1 AND email = ?2 AND created_at > ?9) < ?10
       RETURNING id`,
    )
    .bind(
      event.id,
      email,
      await hashCode(salt, code),
      salt,
      nowIso,
      expiresAt,
      meta.ip,
      new Date(now.getTime() - CODE_COOLDOWN_MS).toISOString(),
      new Date(now.getTime() - 3_600_000).toISOString(),
      CODE_MAX_PER_HOUR,
    )
    .first<{ id: number }>();
  if (!row) return { status: "skipped" };

  const { subject, html, text } = loginCodeEmail({
    audience: "registrant",
    eventTitle: event.title,
    path: registrantPath(event.slug),
    code,
    email,
    requestedAt: nowIso,
    expiresAt,
    validMinutes: CODE_TTL_MS / 60_000,
    appOrigin: meta.appOrigin,
    country: meta.country,
    userAgent: meta.userAgent,
    replyTo: cfg.replyTo,
  });

  try {
    await sendDirectEmail(db, cfg, { to: email, subject, html, text, attachments: [] }, {
      kind: "registrant_code",
      idempotencyKey: `registrant-code:${row.id}:${salt}`,
    });
  } catch (err) {
    const error = String((err as Error)?.message ?? err).slice(0, 300);
    await db.batch([
      db.prepare("DELETE FROM registrant_login_codes WHERE id = ?").bind(row.id),
      auditStatement(db, email, "registrant.code_failed", null, { error }, nowIso),
    ]);
    console.error(`registrant code for ${email} failed: ${error}`);
    return { status: "failed", error };
  }

  if (cfg.mode === "log") console.log(`[dev] registrant code for ${email}: ${code} (also in /admin/outbox)`);
  await auditStatement(db, email, "registrant.code_sent", null, { event: event.id, ip: meta.ip }, nowIso).run();
  return { status: "sent", codeId: row.id };
}

const INVALID = "Kode salah atau sudah kedaluwarsa. Periksa kembali, atau minta kode baru.";

/** Same attempt counting and single-use marking as verifyLoginCode. */
export async function verifyRegistrantCode(
  db: D1Database,
  eventId: number,
  emailRaw: string,
  codeRaw: string,
  now = new Date(),
): Promise<VerifyCodeResult> {
  const email = normalizeEmail(emailRaw);
  const code = normalizeCode(codeRaw);
  if (!code) return { ok: false, message: "Masukkan 6 digit kode dari email." };
  const nowIso = now.toISOString();

  const row = await db
    .prepare(
      `UPDATE registrant_login_codes SET attempts = attempts + 1
       WHERE id = (SELECT id FROM registrant_login_codes WHERE event_id = ? AND email = ? ORDER BY id DESC LIMIT 1)
         AND used_at IS NULL AND expires_at > ? AND attempts < ?
       RETURNING id, code_hash, salt, attempts`,
    )
    .bind(eventId, email, nowIso, CODE_MAX_ATTEMPTS)
    .first<{ id: number; code_hash: string; salt: string; attempts: number }>();
  if (!row) return { ok: false, message: INVALID };

  if (!timingSafeEqual(await hashCode(row.salt, code), row.code_hash)) {
    if (row.attempts >= CODE_MAX_ATTEMPTS) {
      await auditStatement(db, email, "registrant.code_locked", null, { event: eventId }, nowIso).run();
      return { ok: false, message: "Terlalu banyak percobaan. Minta kode baru." };
    }
    return { ok: false, message: INVALID };
  }

  const used = await db
    .prepare("UPDATE registrant_login_codes SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .bind(nowIso, row.id)
    .run();
  if ((used.meta.changes ?? 0) !== 1) return { ok: false, message: INVALID };
  return { ok: true };
}

/** Start a registrant session. Null when the email no longer has an active registration for the event. */
export async function createRegistrantSession(
  db: D1Database,
  eventId: number,
  emailRaw: string,
  meta: Pick<RequestMeta, "ip" | "userAgent">,
  now = new Date(),
): Promise<{ token: string; expiresAt: string } | null> {
  const email = normalizeEmail(emailRaw);
  const token = randomToken();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + REGISTRANT_SESSION_TTL_MS).toISOString();

  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO registrant_sessions (token_hash, event_id, email, created_at, expires_at, ip, user_agent)
         SELECT ?3, ?1, ?2, ?4, ?5, ?6, ?7 WHERE EXISTS (${ACTIVE_REGISTRATION_SQL})`,
      )
      .bind(eventId, email, await sha256Hex(token), nowIso, expiresAt, meta.ip, meta.userAgent),
    db.prepare("DELETE FROM registrant_sessions WHERE expires_at <= ?").bind(nowIso),
    db
      .prepare("DELETE FROM registrant_login_codes WHERE created_at <= ?")
      .bind(new Date(now.getTime() - 24 * 3_600_000).toISOString()),
  ]);
  if ((insert.meta.changes ?? 0) !== 1) return null;
  await auditStatement(db, email, "registrant.login", null, { event: eventId }, nowIso).run();
  return { token, expiresAt };
}

async function tokenHash(request: Request): Promise<string | null> {
  const token = readCookie(request, cookieName(isSecureRequest(request)));
  if (!token || token.length < 32 || token.length > 128) return null;
  return sha256Hex(token);
}

/** The registrant signed in for this event (email), or null. */
export async function identifyRegistrant(
  db: D1Database,
  request: Request,
  eventId: number,
  now = new Date(),
): Promise<{ email: string } | null> {
  const hash = await tokenHash(request);
  if (!hash) return null;
  return db
    .prepare("SELECT email FROM registrant_sessions WHERE token_hash = ? AND event_id = ? AND expires_at > ?")
    .bind(hash, eventId, now.toISOString())
    .first<{ email: string }>();
}

export async function destroyRegistrantSession(db: D1Database, request: Request) {
  const hash = await tokenHash(request);
  if (hash) await db.prepare("DELETE FROM registrant_sessions WHERE token_hash = ?").bind(hash).run();
}

export function registrantCookie(request: Request, token: string) {
  const secure = isSecureRequest(request);
  return serializeCookie(cookieName(secure), token, { maxAge: REGISTRANT_SESSION_TTL_MS / 1000, secure });
}

export function clearRegistrantCookie(request: Request) {
  const secure = isSecureRequest(request);
  return serializeCookie(cookieName(secure), "", { maxAge: 0, secure });
}
