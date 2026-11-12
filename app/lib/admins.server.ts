import { auditStatement } from "./db.server";

export interface AdminRow {
  email: string;
  name: string | null;
  added_by: string;
  added_at: string;
  last_login_at: string | null;
}

export type AdminResult = { ok: true; message: string } | { ok: false; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export function parseEmailList(list: string | undefined): string[] {
  return [...new Set((list ?? "").split(/[,;\s]+/).map(normalizeEmail).filter((e) => EMAIL_RE.test(e)))];
}

/**
 * First run only: when the admins table is empty, seed it from the ADMIN_EMAILS var.
 * After that the table is the single source of truth; the var is never consulted again.
 */
export async function ensureBootstrap(db: D1Database, seed: string | undefined, now = new Date()): Promise<boolean> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM admins").first<{ n: number }>();
  if ((row?.n ?? 0) > 0) return false;
  const emails = parseEmailList(seed);
  if (emails.length === 0) return false;
  const nowIso = now.toISOString();
  await db.batch([
    ...emails.map((e) =>
      db
        .prepare("INSERT OR IGNORE INTO admins (email, added_by, added_at) VALUES (?, 'bootstrap', ?)")
        .bind(e, nowIso),
    ),
    auditStatement(db, "system", "admin.bootstrap", null, { emails }, nowIso),
  ]);
  return true;
}

export async function isAdmin(db: D1Database, email: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM admins WHERE email = ?").bind(normalizeEmail(email)).first();
  return !!row;
}

/** Record the last login at most once per hour (avoids a write on every request). */
export async function touchLogin(db: D1Database, email: string, now = new Date()) {
  await db
    .prepare("UPDATE admins SET last_login_at = ? WHERE email = ? AND (last_login_at IS NULL OR last_login_at < ?)")
    .bind(now.toISOString(), normalizeEmail(email), new Date(now.getTime() - 3_600_000).toISOString())
    .run();
}

export async function listAdmins(db: D1Database): Promise<AdminRow[]> {
  const { results } = await db.prepare("SELECT * FROM admins ORDER BY added_at, email").all<AdminRow>();
  return results;
}

export async function addAdmin(
  db: D1Database,
  actor: string,
  emailRaw: string,
  nameRaw = "",
  now = new Date(),
): Promise<AdminResult> {
  const email = normalizeEmail(emailRaw);
  if (!EMAIL_RE.test(email)) return { ok: false, message: "Format email tidak valid." };
  const name = nameRaw.trim().slice(0, 120) || null;
  const nowIso = now.toISOString();

  const res = await db
    .prepare("INSERT OR IGNORE INTO admins (email, name, added_by, added_at) VALUES (?, ?, ?, ?)")
    .bind(email, name, normalizeEmail(actor), nowIso)
    .run();
  if ((res.meta.changes ?? 0) !== 1) return { ok: false, message: `${email} sudah menjadi admin.` };

  await auditStatement(db, actor, "admin.add", email, name ? { name } : undefined, nowIso).run();
  return { ok: true, message: `${email} ditambahkan sebagai admin.` };
}

/**
 * Remove an admin. Two safeguards, both enforced in SQL so concurrent removals cannot lock everyone out:
 * you cannot remove yourself, and the last remaining admin can never be removed.
 */
export async function removeAdmin(
  db: D1Database,
  actor: string,
  emailRaw: string,
  now = new Date(),
): Promise<AdminResult> {
  const email = normalizeEmail(emailRaw);
  if (email === normalizeEmail(actor)) {
    return { ok: false, message: "Anda tidak dapat menghapus diri sendiri. Minta admin lain melakukannya." };
  }
  const res = await db
    .prepare("DELETE FROM admins WHERE email = ? AND (SELECT COUNT(*) FROM admins) > 1")
    .bind(email)
    .run();
  if ((res.meta.changes ?? 0) !== 1) {
    const exists = await db.prepare("SELECT 1 AS ok FROM admins WHERE email = ?").bind(email).first();
    return {
      ok: false,
      message: exists ? "Admin terakhir tidak dapat dihapus." : `${email} bukan admin.`,
    };
  }
  await auditStatement(db, actor, "admin.remove", email, undefined, now.toISOString()).run();
  return { ok: true, message: `${email} dihapus dari daftar admin.` };
}
