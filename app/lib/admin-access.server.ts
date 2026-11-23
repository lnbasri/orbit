import { auditStatement } from "./db.server";
import { getAdmin } from "./admins.server";
import {
  ADMIN_ACCESS_ROLES,
  ADMIN_CAPABILITY_OPTIONS,
  ALL_ADMIN_CAPABILITIES,
  ALL_ADMIN_MODULES,
  type AdminAccessRole,
  type AdminAccessSnapshot,
  type AdminCapability,
  type AdminModule,
} from "./admin-access";
import type { AdminResult } from "./admins.server";

export interface AdminDepartmentRow {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

export interface AdminAccessAssignments {
  roles: Record<string, AdminAccessRole[]>;
  capabilities: Record<string, AdminCapability[]>;
  departmentsByEmail: Record<string, string[]>;
  departments: AdminDepartmentRow[];
}

const isRole = (value: string): value is AdminAccessRole =>
  ADMIN_ACCESS_ROLES.some((role) => role.id === value);

const isCapability = (value: string): value is (typeof ADMIN_CAPABILITY_OPTIONS)[number]["id"] =>
  ADMIN_CAPABILITY_OPTIONS.some((capability) => capability.id === value);

export async function getAdminAccess(
  db: D1Database,
  email: string,
  role: AdminAccessSnapshot["role"],
  dev = false,
): Promise<AdminAccessSnapshot> {
  if (dev || role === "SUPER_ADMIN" || role === "dev") {
    return {
      role,
      roles: [],
      modules: ALL_ADMIN_MODULES,
      capabilities: ALL_ADMIN_CAPABILITIES,
      departments: [],
      isLegacy: false,
    };
  }

  const [roleRows, capabilityRows, departmentRows] = await Promise.all([
    db.prepare("SELECT role FROM admin_role_assignments WHERE admin_email = ? ORDER BY role")
      .bind(email).all<{ role: string }>(),
    db.prepare("SELECT capability FROM admin_capability_grants WHERE admin_email = ? ORDER BY capability")
      .bind(email).all<{ capability: string }>(),
    db.prepare(
      `SELECT d.name FROM admin_departments d
       JOIN admin_department_memberships m ON m.department_id = d.id
       WHERE m.admin_email = ? ORDER BY d.name`,
    ).bind(email).all<{ name: string }>(),
  ]);
  const roles = roleRows.results.map((row) => row.role).filter(isRole);
  const assignedCapabilities = capabilityRows.results
    .map((row) => row.capability)
    .filter(isCapability);
  const departments = departmentRows.results.map((row) => row.name);

  if (role === "ADMIN" && roles.length === 0) {
    return {
      role,
      roles,
      modules: ALL_ADMIN_MODULES,
      capabilities: ALL_ADMIN_CAPABILITIES,
      departments,
      isLegacy: true,
    };
  }

  const modules = new Set<AdminModule>();
  const capabilities = new Set<AdminCapability>(assignedCapabilities);
  for (const assignedRole of roles) {
    const definition = ADMIN_ACCESS_ROLES.find((candidate) => candidate.id === assignedRole);
    if (!definition) continue;
    for (const module of definition.modules) modules.add(module);
    for (const capability of definition.capabilities) capabilities.add(capability);
  }

  return {
    role,
    roles,
    modules: [...modules],
    capabilities: [...capabilities],
    departments,
    isLegacy: false,
  };
}

export async function listAdminAccessAssignments(db: D1Database): Promise<AdminAccessAssignments> {
  const [roleRows, capabilityRows, membershipRows, departments] = await Promise.all([
    db.prepare("SELECT admin_email, role FROM admin_role_assignments ORDER BY admin_email, role")
      .all<{ admin_email: string; role: string }>(),
    db.prepare("SELECT admin_email, capability FROM admin_capability_grants ORDER BY admin_email, capability")
      .all<{ admin_email: string; capability: string }>(),
    db.prepare("SELECT admin_email, department_id FROM admin_department_memberships ORDER BY admin_email, department_id")
      .all<{ admin_email: string; department_id: string }>(),
    db.prepare("SELECT * FROM admin_departments ORDER BY name").all<AdminDepartmentRow>(),
  ]);
  const roles: Record<string, AdminAccessRole[]> = {};
  const capabilities: Record<string, AdminCapability[]> = {};
  const departmentsByEmail: Record<string, string[]> = {};

  for (const row of roleRows.results) {
    if (isRole(row.role)) (roles[row.admin_email] ??= []).push(row.role);
  }
  for (const row of capabilityRows.results) {
    if (isCapability(row.capability)) (capabilities[row.admin_email] ??= []).push(row.capability);
  }
  for (const row of membershipRows.results) {
    (departmentsByEmail[row.admin_email] ??= []).push(row.department_id);
  }

  return { roles, capabilities, departmentsByEmail, departments: departments.results };
}

export async function setAdminAccess(
  db: D1Database,
  actor: string,
  emailRaw: string,
  roleValues: readonly string[],
  capabilityValues: readonly string[],
  departmentIdsRaw: readonly string[],
  now = new Date(),
): Promise<AdminResult> {
  const actorAdmin = await getAdmin(db, actor);
  if (!actorAdmin || actorAdmin.role !== "SUPER_ADMIN") {
    return { ok: false, message: "Only a super administrator can manage administrator access." };
  }

  const email = emailRaw.trim().toLowerCase();
  const targetAdmin = await getAdmin(db, email);
  if (!targetAdmin) return { ok: false, message: `${email} is not an active administrator.` };

  const roles = [...new Set(roleValues)];
  if (roles.some((value) => !isRole(value))) {
    return { ok: false, message: "Choose only supported access roles." };
  }
  const capabilities = [...new Set(capabilityValues)];
  if (capabilities.some((value) => !isCapability(value))) {
    return { ok: false, message: "Choose only supported sensitive permissions." };
  }
  if (targetAdmin.role === "ADMIN" && roles.length === 0) {
    return { ok: false, message: "Assign at least one role; an empty role list restores legacy broad access." };
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

  const at = now.toISOString();
  const statements = [
    db.prepare("DELETE FROM admin_role_assignments WHERE admin_email = ?").bind(email),
    db.prepare("DELETE FROM admin_capability_grants WHERE admin_email = ?").bind(email),
    db.prepare("DELETE FROM admin_department_memberships WHERE admin_email = ?").bind(email),
    ...roles.map((value) =>
      db.prepare(
        "INSERT INTO admin_role_assignments (admin_email, role, assigned_by, assigned_at) VALUES (?, ?, ?, ?)",
      ).bind(email, value, actorAdmin.email, at),
    ),
    ...capabilities.map((value) =>
      db.prepare(
        "INSERT INTO admin_capability_grants (admin_email, capability, assigned_by, assigned_at) VALUES (?, ?, ?, ?)",
      ).bind(email, value, actorAdmin.email, at),
    ),
    ...departmentIds.map((id) =>
      db.prepare(
        "INSERT INTO admin_department_memberships (department_id, admin_email, assigned_by, assigned_at) VALUES (?, ?, ?, ?)",
      ).bind(id, email, actorAdmin.email, at),
    ),
    auditStatement(db, actorAdmin.email, "admin.access.change", email, {
      roles,
      capabilities,
      departments: departmentIds,
    }, at),
  ];
  await db.batch(statements);
  return { ok: true, message: `Access assignments for ${email} were updated.` };
}

export async function createAdminDepartment(
  db: D1Database,
  actor: string,
  nameRaw: string,
  now = new Date(),
): Promise<AdminResult> {
  const actorAdmin = await getAdmin(db, actor);
  if (!actorAdmin || actorAdmin.role !== "SUPER_ADMIN") {
    return { ok: false, message: "Only a super administrator can manage departments." };
  }
  const name = nameRaw.trim();
  if (!name || name.length > 80) {
    return { ok: false, message: "Enter a department name up to 80 characters long." };
  }
  const id = crypto.randomUUID();
  const at = now.toISOString();
  const result = await db.prepare(
    "INSERT OR IGNORE INTO admin_departments (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
  ).bind(id, name, actorAdmin.email, at).run();
  if ((result.meta.changes ?? 0) !== 1) {
    return { ok: false, message: "A department with that name already exists." };
  }
  await auditStatement(db, actorAdmin.email, "admin.department.create", id, { name }, at).run();
  return { ok: true, message: `${name} was added as a department.` };
}
