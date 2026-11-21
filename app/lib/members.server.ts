import { z } from "zod";

import { auditStatement } from "./db.server";

const memberSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
  preferredName: z.string().trim().max(120, "Preferred name is too long."),
  firstName: z.string().trim().max(120, "First name is too long."),
  middleName: z.string().trim().max(120, "Middle name is too long."),
  familyName: z.string().trim().max(120, "Family name is too long."),
  dateOfBirth: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/, "Date of birth is invalid."),
  gender: z.enum(["", "male", "female", "non_binary", "other", "prefer_not_to_say"]),
  address: z.string().trim().max(240, "Address is too long."),
  postalCode: z.string().trim().max(20, "Postal code is too long."),
  city: z.string().trim().max(120, "City is too long."),
  country: z.string().trim().max(120, "Country is too long."),
  preferredLanguage: z.string().trim().max(80, "Preferred language is too long."),
  communicationConsent: z.boolean(),
  email: z.string().trim().toLowerCase().pipe(z.union([z.literal(""), z.email("Enter a valid email address.")])),
  phone: z.string().trim().max(40, "Phone number is too long."),
  status: z.enum(["active", "inactive", "moved", "deceased"]),
  statusNote: z.string().trim().max(2000, "Status notes are too long."),
  joinedOn: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/, "Join date is invalid."),
  notes: z.string().trim().max(2000, "Notes are too long."),
});

export type MemberInput = z.infer<typeof memberSchema>;
export type MemberStatus = MemberInput["status"];

export interface MemberRow {
  id: string;
  full_name: string;
  preferred_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  family_name: string | null;
  date_of_birth: string | null;
  gender: "" | "male" | "female" | "non_binary" | "other" | "prefer_not_to_say" | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  preferred_language: string | null;
  communication_consent: number;
  email: string | null;
  phone: string | null;
  status: MemberStatus;
  status_note: string | null;
  joined_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface HouseholdRow {
  id: string;
  name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  status: "active" | "inactive";
  status_note: string | null;
  created_at: string;
  updated_at: string;
  member_count?: number;
}

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  member_count?: number;
}

export interface MemberHistoryRow {
  id: number;
  changed_at: string;
  changed_by: string;
  changes_json: string;
}

export interface MemberRelationshipRow {
  id: string;
  member_id: string;
  related_member_id: string;
  related_name: string;
  relationship: string;
  valid_from: string;
  valid_until: string | null;
}

export interface MemberAssignmentHistoryRow {
  kind: "Household" | "Group" | "Relationship";
  label: string;
  role: string | null;
  valid_from: string;
  valid_until: string | null;
  changed_by: string;
  ended_by: string | null;
}

export interface MemberFilters {
  q: string;
  status: string;
  page: number;
}

export const MEMBER_PAGE_SIZE = 25;

export type SaveMemberResult =
  | { ok: false; message: string }
  | { ok: true; id: string; message: string };
export type SaveEntityResult =
  | { ok: false; message: string }
  | { ok: true; id: string; message: string };

export async function listMembers(db: D1Database, filters: MemberFilters) {
  const where: string[] = ["archived_at IS NULL"];
  const binds: string[] = [];
  const q = filters.q.trim();
  if (q) {
    where.push("(full_name LIKE ? OR preferred_name LIKE ? OR first_name LIKE ? OR middle_name LIKE ? OR family_name LIKE ? OR email LIKE ? OR phone LIKE ?)");
    const like = `%${q}%`;
    binds.push(like, like, like, like, like, like, like);
  }
  if (filters.status === "active" || filters.status === "inactive" || filters.status === "moved" || filters.status === "deceased") {
    where.push("status = ?");
    binds.push(filters.status);
  }
  const clause = where.join(" AND ");
  const count = await db
    .prepare(`SELECT COUNT(*) AS count FROM members WHERE ${clause}`)
    .bind(...binds)
    .first<{ count: number }>();
  const total = count?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / MEMBER_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page), pageCount);
  const { results } = await db
    .prepare(
      `SELECT id, full_name, preferred_name, first_name, middle_name, family_name,
              date_of_birth, gender, address, postal_code, city, country,
              preferred_language, communication_consent, email, phone, status, status_note,
              joined_on, created_at, updated_at
       FROM members WHERE ${clause} ORDER BY full_name COLLATE NOCASE, id LIMIT ? OFFSET ?`,
    )
    .bind(...binds, MEMBER_PAGE_SIZE, (page - 1) * MEMBER_PAGE_SIZE)
    .all<MemberRow>();
  return {
    members: results,
    count: total,
    page,
    pageCount,
  };
}

export async function getMember(db: D1Database, id: string) {
  return db
    .prepare("SELECT * FROM members WHERE id = ? AND archived_at IS NULL")
    .bind(id)
    .first<MemberRow & { notes: string | null }>();
}

export async function getMemberProfile(db: D1Database, id: string) {
  const [member, household, groups, relationships, history, assignmentHistory] = await Promise.all([
    getMember(db, id),
    db
      .prepare(
        `SELECT h.*, mh.role FROM member_households mh
         JOIN households h ON h.id = mh.household_id
         WHERE mh.member_id = ? AND mh.valid_until IS NULL`,
      )
      .bind(id)
      .first<(HouseholdRow & { role: string }) | null>(),
    db
      .prepare(
        `SELECT g.id, g.name, g.description, mg.role
         FROM member_group_memberships mg JOIN administrative_groups g ON g.id = mg.group_id
         WHERE mg.member_id = ? AND mg.valid_until IS NULL ORDER BY g.name COLLATE NOCASE`,
      )
      .bind(id)
      .all<GroupRow & { role: string }>(),
    db
      .prepare(
        `SELECT r.*, m.full_name AS related_name FROM member_relationships r
         JOIN members m ON m.id = r.related_member_id
         WHERE r.member_id = ? AND r.valid_until IS NULL ORDER BY m.full_name COLLATE NOCASE`,
      )
      .bind(id)
      .all<MemberRelationshipRow>(),
    db
      .prepare("SELECT * FROM member_history WHERE member_id = ? ORDER BY changed_at DESC, id DESC LIMIT 50")
      .bind(id)
      .all<MemberHistoryRow>(),
    db
      .prepare(
        `SELECT 'Household' AS kind, h.name AS label, mh.role, mh.valid_from, mh.valid_until,
                mh.assigned_by AS changed_by, mh.ended_by
         FROM member_households mh JOIN households h ON h.id = mh.household_id
         WHERE mh.member_id = ?
         UNION ALL
         SELECT 'Group' AS kind, g.name AS label, mg.role, mg.valid_from, mg.valid_until,
                mg.assigned_by AS changed_by, mg.ended_by
         FROM member_group_memberships mg JOIN administrative_groups g ON g.id = mg.group_id
         WHERE mg.member_id = ?
         UNION ALL
         SELECT 'Relationship' AS kind, m.full_name || ' · ' || r.relationship AS label, NULL AS role,
                r.valid_from, r.valid_until, r.created_by AS changed_by, r.ended_by
         FROM member_relationships r JOIN members m ON m.id = r.related_member_id
         WHERE r.member_id = ?
         ORDER BY valid_from DESC`,
      )
      .bind(id, id, id)
      .all<MemberAssignmentHistoryRow>(),
  ]);
  return {
    member,
    household,
    groups: groups.results,
    relationships: relationships.results,
    history: history.results,
    assignmentHistory: assignmentHistory.results,
  };
}

export async function listHouseholds(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT h.*, COUNT(mh.member_id) AS member_count FROM households h
       LEFT JOIN member_households mh ON mh.household_id = h.id AND mh.valid_until IS NULL
       GROUP BY h.id ORDER BY h.name COLLATE NOCASE`,
    )
    .all<HouseholdRow>();
  return results;
}

export async function listGroups(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT g.*, COUNT(mg.member_id) AS member_count FROM administrative_groups g
       LEFT JOIN member_group_memberships mg ON mg.group_id = g.id AND mg.valid_until IS NULL
       GROUP BY g.id ORDER BY g.name COLLATE NOCASE`,
    )
    .all<GroupRow>();
  return results;
}

export async function listActiveMembers(db: D1Database, exceptId?: string) {
  const statement = exceptId
    ? db
        .prepare("SELECT id, full_name FROM members WHERE archived_at IS NULL AND id <> ? ORDER BY full_name COLLATE NOCASE")
        .bind(exceptId)
    : db.prepare("SELECT id, full_name FROM members WHERE archived_at IS NULL ORDER BY full_name COLLATE NOCASE");
  const { results } = await statement.all<{ id: string; full_name: string }>();
  return results;
}

export async function saveMember(
  db: D1Database,
  actor: string,
  raw: {
    fullName: string;
    preferredName: string;
    firstName: string;
    middleName: string;
    familyName: string;
    dateOfBirth: string;
    gender: string;
    address: string;
    postalCode: string;
    city: string;
    country: string;
    preferredLanguage: string;
    communicationConsent: boolean;
    email: string;
    phone: string;
    status: string;
    statusNote: string;
    joinedOn: string;
    notes: string;
  },
  id?: string,
  householdId = "",
  groupIds: string[] = [],
  now = new Date(),
  groupRoles: Record<string, string> = {},
): Promise<SaveMemberResult> {
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Member data is invalid." };
  const value = parsed.data;
  const generatedFullName = [value.firstName, value.middleName, value.familyName].filter(Boolean).join(" ").trim();
  if (generatedFullName) value.fullName = generatedFullName;
  const timestamp = now.toISOString();
  const uniqueGroupIds = [...new Set(groupIds.filter(Boolean))];
  const [member, households, allGroups] = await Promise.all([
    id ? getMember(db, id) : Promise.resolve(null),
    listHouseholds(db),
    listGroups(db),
  ]);
  if (id && !member) return { ok: false, message: "Member not found." };
  if (householdId && !households.some((h) => h.id === householdId)) {
    return { ok: false, message: "The selected household was not found." };
  }
  if (uniqueGroupIds.some((groupId) => !allGroups.some((group) => group.id === groupId))) {
    return { ok: false, message: "One of the selected groups was not found." };
  }
  for (const role of Object.values(groupRoles)) {
    if (!z.string().trim().max(80).safeParse(role).success) {
      return { ok: false, message: "Group roles must be 80 characters or fewer." };
    }
  }

  const memberId = id ?? crypto.randomUUID();
  const changes = member
    ? diffMember(member, value)
    : {
        full_name: { from: null, to: value.fullName },
        preferred_name: { from: null, to: value.preferredName || null },
        first_name: { from: null, to: value.firstName || null },
        middle_name: { from: null, to: value.middleName || null },
        family_name: { from: null, to: value.familyName || null },
        date_of_birth: { from: null, to: value.dateOfBirth || null },
        gender: { from: null, to: value.gender || null },
        address: { from: null, to: value.address || null },
        postal_code: { from: null, to: value.postalCode || null },
        city: { from: null, to: value.city || null },
        country: { from: null, to: value.country || null },
        preferred_language: { from: null, to: value.preferredLanguage || null },
        communication_consent: { from: null, to: value.communicationConsent ? 1 : 0 },
        email: { from: null, to: value.email || null },
        phone: { from: null, to: value.phone || null },
        status: { from: null, to: value.status },
        status_note: { from: null, to: value.statusNote || null },
        joined_on: { from: null, to: value.joinedOn || null },
        notes: { from: null, to: value.notes || null },
      };

  const statements: D1PreparedStatement[] = [];
  if (member) {
    statements.push(
      db
        .prepare(
          `UPDATE members SET
             full_name = ?, preferred_name = ?, first_name = ?, middle_name = ?, family_name = ?,
             date_of_birth = ?, gender = ?, address = ?, postal_code = ?, city = ?, country = ?,
             preferred_language = ?, communication_consent = ?, email = ?, phone = ?, status = ?,
             status_note = ?, joined_on = ?, notes = ?, updated_at = ?
           WHERE id = ? AND archived_at IS NULL`,
        )
        .bind(
          value.fullName,
          value.preferredName || null,
          value.firstName || null,
          value.middleName || null,
          value.familyName || null,
          value.dateOfBirth || null,
          value.gender || null,
          value.address || null,
          value.postalCode || null,
          value.city || null,
          value.country || null,
          value.preferredLanguage || null,
          value.communicationConsent ? 1 : 0,
          value.email || null,
          value.phone || null,
          value.status,
          value.statusNote || null,
          value.joinedOn || null,
          value.notes || null,
          timestamp,
          memberId,
        ),
    );
  } else {
    statements.push(
      db
        .prepare(
          `INSERT INTO members
           (id, full_name, preferred_name, first_name, middle_name, family_name,
            date_of_birth, gender, address, postal_code, city, country,
            preferred_language, communication_consent, email, phone, status, status_note,
            joined_on, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          memberId,
          value.fullName,
          value.preferredName || null,
          value.firstName || null,
          value.middleName || null,
          value.familyName || null,
          value.dateOfBirth || null,
          value.gender || null,
          value.address || null,
          value.postalCode || null,
          value.city || null,
          value.country || null,
          value.preferredLanguage || null,
          value.communicationConsent ? 1 : 0,
          value.email || null,
          value.phone || null,
          value.status,
          value.statusNote || null,
          value.joinedOn || null,
          value.notes || null,
          timestamp,
          timestamp,
        ),
    );
  }

  if (Object.keys(changes).length) {
    statements.push(
      db
        .prepare("INSERT INTO member_history (member_id, changed_at, changed_by, changes_json) VALUES (?, ?, ?, ?)")
        .bind(memberId, timestamp, actor, JSON.stringify(changes)),
    );
  }
  statements.push(...await householdAssignmentStatements(db, actor, memberId, householdId, timestamp));
  statements.push(...await groupAssignmentStatements(db, actor, memberId, uniqueGroupIds, groupRoles, timestamp));
  if (Object.keys(changes).length || !member) {
    statements.push(auditStatement(db, actor, member ? "member.update" : "member.create", memberId, { fields: Object.keys(changes) }, timestamp));
  }
  await db.batch(statements);
  return { ok: true, id: memberId, message: member ? "Member changes saved." : "Member added." };
}

function diffMember(member: MemberRow, value: MemberInput) {
  const fields = {
    full_name: [member.full_name, value.fullName],
    preferred_name: [member.preferred_name, value.preferredName || null],
    first_name: [member.first_name, value.firstName || null],
    middle_name: [member.middle_name, value.middleName || null],
    family_name: [member.family_name, value.familyName || null],
    date_of_birth: [member.date_of_birth, value.dateOfBirth || null],
    gender: [member.gender, value.gender || null],
    address: [member.address, value.address || null],
    postal_code: [member.postal_code, value.postalCode || null],
    city: [member.city, value.city || null],
    country: [member.country, value.country || null],
    preferred_language: [member.preferred_language, value.preferredLanguage || null],
    communication_consent: [member.communication_consent, value.communicationConsent ? 1 : 0],
    email: [member.email, value.email || null],
    phone: [member.phone, value.phone || null],
    status: [member.status, value.status],
    status_note: [member.status_note, value.statusNote || null],
    joined_on: [member.joined_on, value.joinedOn || null],
    notes: [member.notes, value.notes || null],
  } as const;
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, [before, after]]) => before !== after)
      .map(([key, [before, after]]) => [key, { from: before, to: after }]),
  );
}

async function householdAssignmentStatements(db: D1Database, actor: string, memberId: string, householdId: string, timestamp: string) {
  const current = await db
    .prepare("SELECT household_id FROM member_households WHERE member_id = ? AND valid_until IS NULL")
    .bind(memberId)
    .first<{ household_id: string }>();
  if ((current?.household_id ?? "") === householdId) return [];
  const statements: D1PreparedStatement[] = [];
  if (current) {
    statements.push(
      db
        .prepare("UPDATE member_households SET valid_until = ?, ended_by = ? WHERE member_id = ? AND valid_until IS NULL")
        .bind(timestamp, actor, memberId),
    );
  }
  if (householdId) {
    statements.push(
      db
        .prepare("INSERT INTO member_households (member_id, household_id, assigned_by, valid_from) VALUES (?, ?, ?, ?)")
        .bind(memberId, householdId, actor, timestamp),
    );
  }
  statements.push(auditStatement(db, actor, "member.household.change", memberId, {
    from: current?.household_id ?? null,
    to: householdId || null,
  }, timestamp));
  return statements;
}

async function groupAssignmentStatements(
  db: D1Database,
  actor: string,
  memberId: string,
  groupIds: string[],
  groupRoles: Record<string, string>,
  timestamp: string,
) {
  const { results: current } = await db
    .prepare("SELECT group_id, role FROM member_group_memberships WHERE member_id = ? AND valid_until IS NULL")
    .bind(memberId)
    .all<{ group_id: string; role: string }>();
  const currentById = new Map(current.map((row) => [row.group_id, row.role]));
  const currentIds = new Set(currentById.keys());
  const nextIds = new Set(groupIds);
  const statements: D1PreparedStatement[] = [];
  for (const groupId of currentIds) {
    const nextRole = groupRoles[groupId]?.trim() || "member";
    if (!nextIds.has(groupId) || currentById.get(groupId) !== nextRole) {
      statements.push(
        db
          .prepare("UPDATE member_group_memberships SET valid_until = ?, ended_by = ? WHERE member_id = ? AND group_id = ? AND valid_until IS NULL")
          .bind(timestamp, actor, memberId, groupId),
      );
    }
  }
  for (const groupId of nextIds) {
    const nextRole = groupRoles[groupId]?.trim() || "member";
    if (!currentIds.has(groupId) || currentById.get(groupId) !== nextRole) {
      statements.push(
        db.prepare("INSERT INTO member_group_memberships (member_id, group_id, role, assigned_by, valid_from) VALUES (?, ?, ?, ?, ?)")
          .bind(memberId, groupId, nextRole, actor, timestamp),
      );
    }
  }
  const added = [...nextIds].filter((groupId) => !currentIds.has(groupId));
  const removed = [...currentIds].filter((groupId) => !nextIds.has(groupId));
  const roleChanges = [...nextIds]
    .filter((groupId) => currentIds.has(groupId) && currentById.get(groupId) !== (groupRoles[groupId]?.trim() || "member"))
    .map((groupId) => ({ groupId, from: currentById.get(groupId), to: groupRoles[groupId]?.trim() || "member" }));
  if (added.length || removed.length || roleChanges.length) {
    statements.push(auditStatement(db, actor, "member.groups.change", memberId, { added, removed, roleChanges }, timestamp));
  }
  return statements;
}

export async function saveHousehold(
  db: D1Database,
  actor: string,
  input: { name: string; address: string; postalCode: string; city: string; country: string; status: string; statusNote: string },
  id?: string,
  now = new Date(),
): Promise<SaveEntityResult> {
  const parsed = z.object({
    name: z.string().trim().min(1, "Household name is required.").max(120),
    address: z.string().trim().max(240),
    postalCode: z.string().trim().max(20),
    city: z.string().trim().max(120),
    country: z.string().trim().max(120),
    status: z.enum(["active", "inactive"]),
    statusNote: z.string().trim().max(2000),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Household data is invalid." };
  const householdId = id ?? crypto.randomUUID();
  if (id && !(await db.prepare("SELECT 1 FROM households WHERE id = ?").bind(id).first())) {
    return { ok: false, message: "Household not found." };
  }
  const timestamp = now.toISOString();
  const { name, address, postalCode, city, country, status, statusNote } = parsed.data;
  await db.batch(id ? [
    db
      .prepare("UPDATE households SET name = ?, address = ?, postal_code = ?, city = ?, country = ?, status = ?, status_note = ?, updated_at = ? WHERE id = ?")
      .bind(name, address || null, postalCode || null, city || null, country || null, status, statusNote || null, timestamp, id),
    auditStatement(db, actor, "household.update", id, { name, status, statusNote: statusNote || null }, timestamp),
  ] : [
    db
      .prepare(
        `INSERT INTO households (id, name, address, postal_code, city, country, status, status_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(householdId, name, address || null, postalCode || null, city || null, country || null, status, statusNote || null, timestamp, timestamp),
    auditStatement(db, actor, "household.create", householdId, { name, status, statusNote: statusNote || null }, timestamp),
  ]);
  return { ok: true, id: householdId, message: id ? "Household updated." : "Household added." };
}

export async function saveGroup(
  db: D1Database,
  actor: string,
  input: { name: string; description: string },
  id?: string,
  now = new Date(),
): Promise<SaveEntityResult> {
  const parsed = z.object({
    name: z.string().trim().min(1, "Group name is required.").max(120),
    description: z.string().trim().max(500),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Group data is invalid." };
  const { name, description } = parsed.data;
  const duplicate = await db
    .prepare("SELECT 1 FROM administrative_groups WHERE name = ? COLLATE NOCASE AND (? IS NULL OR id <> ?)")
    .bind(name, id ?? null, id ?? null)
    .first();
  if (duplicate) return { ok: false, message: "That group name is already in use." };
  if (id && !(await db.prepare("SELECT 1 FROM administrative_groups WHERE id = ?").bind(id).first())) {
    return { ok: false, message: "Group not found." };
  }
  const groupId = id ?? crypto.randomUUID();
  const timestamp = now.toISOString();
  await db.batch(id ? [
    db
      .prepare("UPDATE administrative_groups SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .bind(name, description || null, timestamp, id),
    auditStatement(db, actor, "group.update", id, { name }, timestamp),
  ] : [
    db
      .prepare("INSERT INTO administrative_groups (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(groupId, name, description || null, timestamp, timestamp),
    auditStatement(db, actor, "group.create", groupId, { name }, timestamp),
  ]);
  return { ok: true, id: groupId, message: id ? "Group updated." : "Group added." };
}

export async function addMemberRelationship(
  db: D1Database,
  actor: string,
  memberId: string,
  relatedMemberId: string,
  relationship: string,
  now = new Date(),
) {
  const parsed = z.object({
    memberId: z.string().min(1),
    relatedMemberId: z.string().min(1),
    relationship: z.string().trim().min(1, "Relationship type is required.").max(80),
  }).safeParse({ memberId, relatedMemberId, relationship });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Relationship is invalid." };
  if (parsed.data.memberId === parsed.data.relatedMemberId) {
    return { ok: false, message: "A member cannot have a relationship with themselves." };
  }
  const { results } = await db
    .prepare("SELECT id FROM members WHERE archived_at IS NULL AND id IN (?, ?)")
    .bind(parsed.data.memberId, parsed.data.relatedMemberId)
    .all<{ id: string }>();
  if (results.length !== 2) return { ok: false, message: "One of the selected members was not found." };
  const duplicate = await db
    .prepare(
      `SELECT 1 FROM member_relationships
       WHERE member_id = ? AND related_member_id = ? AND relationship = ? AND valid_until IS NULL`,
    )
    .bind(parsed.data.memberId, parsed.data.relatedMemberId, parsed.data.relationship)
    .first();
  if (duplicate) return { ok: false, message: "That relationship is already recorded." };
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO member_relationships (id, member_id, related_member_id, relationship, created_by, valid_from)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, parsed.data.memberId, parsed.data.relatedMemberId, parsed.data.relationship, actor, timestamp),
    auditStatement(db, actor, "member.relationship.add", parsed.data.memberId, {
      relationshipId: id,
      relatedMemberId: parsed.data.relatedMemberId,
      relationship: parsed.data.relationship,
    }, timestamp),
  ]);
  return { ok: true, message: "Relationship added." };
}

export async function endMemberRelationship(db: D1Database, actor: string, memberId: string, relationshipId: string, now = new Date()) {
  const timestamp = now.toISOString();
  const result = await db.batch([
    db
      .prepare("UPDATE member_relationships SET valid_until = ?, ended_by = ? WHERE id = ? AND member_id = ? AND valid_until IS NULL")
      .bind(timestamp, actor, relationshipId, memberId),
    auditStatement(db, actor, "member.relationship.end", memberId, { relationshipId }, timestamp),
  ]);
  if (!result[0]?.meta.changes) return { ok: false, message: "Relationship not found or already ended." };
  return { ok: true, message: "Relationship ended." };
}
