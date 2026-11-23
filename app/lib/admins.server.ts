import { auditStatement } from "./db.server";
import { ADMIN_ACCESS_ROLES, ADMIN_CAPABILITY_OPTIONS } from "./admin-access";

export interface AdminRow {
  email: string;
  name: string | null;
  role: "SUPER_ADMIN" | "ADMIN";
  active: number;
  added_by: string;
  added_at: string;
  last_login_at: string | null;
}

export type AdminResult = { ok: true; message: string } | { ok: false; message: string };
export type AdminRole = "SUPER_ADMIN" | "ADMIN";

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
        .prepare("INSERT OR IGNORE INTO admins (email, role, active, added_by, added_at) VALUES (?, 'SUPER_ADMIN', 1, 'bootstrap', ?)")
        .bind(e, nowIso),
    ),
    auditStatement(db, "system", "admin.bootstrap", null, { emails }, nowIso),
  ]);
  return true;
}

export async function isAdmin(db: D1Database, email: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM admins WHERE email = ? AND active = 1").bind(normalizeEmail(email)).first();
  return !!row;
}

export async function getAdmin(db: D1Database, email: string): Promise<AdminRow | null> {
  return db
    .prepare("SELECT * FROM admins WHERE email = ? AND active = 1")
    .bind(normalizeEmail(email))
    .first<AdminRow>();
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
  role: AdminRole = "ADMIN",
  now = new Date(),
  roleValues: readonly string[] = role === "ADMIN" ? ["MEMBERSHIP"] : [],
  capabilityValues: readonly string[] = [],
  departmentIdsRaw: readonly string[] = [],
): Promise<AdminResult> {
  const email = normalizeEmail(emailRaw);
  if (!EMAIL_RE.test(email)) return { ok: false, message: "Enter a valid email address." };
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") return { ok: false, message: "Unknown administrator role." };
  const roles = [...new Set(roleValues)];
  if (roles.some((value) => !ADMIN_ACCESS_ROLES.some((candidate) => candidate.id === value))) {
    return { ok: false, message: "Choose only supported access roles." };
  }
  if (role === "ADMIN" && roles.length === 0) {
    return { ok: false, message: "Assign at least one role to a new administrator." };
  }
  const capabilities = [...new Set(capabilityValues)];
  if (capabilities.some((value) => !ADMIN_CAPABILITY_OPTIONS.some((candidate) => candidate.id === value))) {
    return { ok: false, message: "Choose only supported sensitive permissions." };
  }
  const departmentIds = [...new Set(departmentIdsRaw)];
  if (departmentIds.length) {
    const placeholders = departmentIds.map(() => "?").join(", ");
    const found = await db.prepare(`SELECT id FROM admin_departments WHERE id IN (${placeholders})`)
      .bind(...departmentIds).all<{ id: string }>();
    if (found.results.length !== departmentIds.length) {
      return { ok: false, message: "One or more selected departments are not available." };
    }
  }
  const actorAdmin = await getAdmin(db, actor);
  if (!actorAdmin || actorAdmin.role !== "SUPER_ADMIN") {
    return { ok: false, message: "Only a super administrator can manage administrators." };
  }
  const name = nameRaw.trim().slice(0, 120) || null;
  const nowIso = now.toISOString();

  const res = await db
    .prepare("INSERT OR IGNORE INTO admins (email, name, role, active, added_by, added_at) VALUES (?, ?, ?, 1, ?, ?)")
    .bind(email, name, role, normalizeEmail(actor), nowIso)
    .run();
  if ((res.meta.changes ?? 0) !== 1) return { ok: false, message: `${email} is already an administrator.` };

  await db.batch([
    ...roles.map((value) =>
      db.prepare(
        "INSERT INTO admin_role_assignments (admin_email, role, assigned_by, assigned_at) VALUES (?, ?, ?, ?)",
      ).bind(email, value, actorAdmin.email, nowIso),
    ),
    ...capabilities.map((value) =>
      db.prepare(
        "INSERT INTO admin_capability_grants (admin_email, capability, assigned_by, assigned_at) VALUES (?, ?, ?, ?)",
      ).bind(email, value, actorAdmin.email, nowIso),
    ),
    ...departmentIds.map((id) =>
      db.prepare(
        "INSERT INTO admin_department_memberships (department_id, admin_email, assigned_by, assigned_at) VALUES (?, ?, ?, ?)",
      ).bind(id, email, actorAdmin.email, nowIso),
    ),
    auditStatement(db, actorAdmin.email, "admin.add", email, {
      ...(name ? { name } : {}),
      role,
      accessRoles: roles,
      capabilities,
      departments: departmentIds,
    }, nowIso),
  ]);
  return { ok: true, message: `${email} was added as an administrator.` };
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
  const actorAdmin = await getAdmin(db, actor);
  if (!actorAdmin || actorAdmin.role !== "SUPER_ADMIN") {
    return { ok: false, message: "Only a super administrator can manage administrators." };
  }
  if (email === normalizeEmail(actor)) {
    return { ok: false, message: "You cannot remove yourself. Ask another administrator." };
  }
  const removed = await db
    .prepare("DELETE FROM admins WHERE email = ? AND (SELECT COUNT(*) FROM admins) > 1 RETURNING email")
    .bind(email)
    .first<{ email: string }>();
  if (!removed) {
    const exists = await db.prepare("SELECT 1 AS ok FROM admins WHERE email = ?").bind(email).first();
    return {
      ok: false,
      message: exists ? "The last administrator cannot be removed." : `${email} is not an administrator.`,
    };
  }
  // End their sessions too (the session lookup already requires an admins row; this keeps the table clean).
  await db.batch([
    db.prepare("DELETE FROM admin_sessions WHERE email = ?").bind(email),
    auditStatement(db, actor, "admin.remove", email, undefined, now.toISOString()),
  ]);
  return { ok: true, message: `${email} was removed from the administrator list.` };
}

export async function setAdminRole(
  db: D1Database,
  actor: string,
  emailRaw: string,
  role: AdminRole,
  now = new Date(),
): Promise<AdminResult> {
  const actorAdmin = await getAdmin(db, actor);
  if (!actorAdmin || actorAdmin.role !== "SUPER_ADMIN") {
    return { ok: false, message: "Only a super administrator can manage administrator roles." };
  }
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return { ok: false, message: "Unknown administrator role." };
  }
  const email = normalizeEmail(emailRaw);
  const targetAdmin = await getAdmin(db, email);
  if (!targetAdmin) return { ok: false, message: `${email} is not an active administrator.` };
  if (email === normalizeEmail(actor) && role !== "SUPER_ADMIN") {
    return { ok: false, message: "You cannot remove your own super administrator role." };
  }
  if (targetAdmin.role === "SUPER_ADMIN" && role === "ADMIN") {
    const roleCount = await db.prepare(
      "SELECT COUNT(*) AS count FROM admin_role_assignments WHERE admin_email = ?",
    ).bind(email).first<{ count: number }>();
    if ((roleCount?.count ?? 0) === 0) {
      return { ok: false, message: "Assign at least one access role before demoting a super administrator." };
    }
  }
  const result = await db
    .prepare("UPDATE admins SET role = ? WHERE email = ? AND active = 1")
    .bind(role, email)
    .run();
  if ((result.meta.changes ?? 0) !== 1) return { ok: false, message: `${email} is not an active administrator.` };
  await auditStatement(db, actor, "admin.role.change", email, { role }, now.toISOString()).run();
  return { ok: true, message: `${email} is now ${role === "SUPER_ADMIN" ? "a super administrator" : "an administrator"}.` };
}
