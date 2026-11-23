import { z } from "zod";
import Papa from "papaparse";
import { strToU8, zipSync } from "fflate";

import { auditStatement } from "./db.server";

const memberSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, "Name is required.")
      .max(120, "Name is too long."),
    preferredName: z.string().trim().max(120, "Preferred name is too long."),
    firstName: z
      .string()
      .trim()
      .min(1, "First name is required.")
      .max(120, "First name is too long."),
    middleName: z.string().trim().max(120, "Middle name is too long."),
    familyName: z
      .string()
      .trim()
      .min(1, "Family name is required.")
      .max(120, "Family name is too long."),
    dateOfBirth: z
      .string()
      .regex(/^$|^\d{4}-\d{2}-\d{2}$/, "Date of birth is invalid."),
    gender: z.enum(["male", "female"]),
    address: z.string().trim().max(240, "Address is too long."),
    postalCode: z.string().trim().max(20, "Postal code is too long."),
    city: z.string().trim().max(120, "City is too long."),
    country: z.string().trim().max(120, "Country is too long."),
    preferredLanguage: z
      .string()
      .trim()
      .max(80, "Preferred language is too long."),
    communicationConsent: z.boolean(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.union([z.literal(""), z.email("Enter a valid email address.")])),
    phone: z.string().trim().max(40, "Phone number is too long."),
    status: z.enum(["active", "inactive", "moved", "deceased"]),
    statusNote: z.string().trim().max(2000, "Status notes are too long."),
    joinedOn: z
      .string()
      .regex(/^$|^\d{4}-\d{2}-\d{2}$/, "Join date is invalid."),
    notes: z.string().trim().max(2000, "Notes are too long."),
  })
  .superRefine((value, ctx) => {
    if (!value.dateOfBirth) return;
    const date = new Date(`${value.dateOfBirth}T00:00:00Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value.dateOfBirth
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["dateOfBirth"],
        message: "Date of birth is invalid.",
      });
    } else if (date > new Date()) {
      ctx.addIssue({
        code: "custom",
        path: ["dateOfBirth"],
        message: "Date of birth cannot be in the future.",
      });
    }
  });

const householdSchema = z.object({
  name: z.string().trim().min(1, "Household name is required.").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Household email is too long.")
    .pipe(z.union([z.literal(""), z.email("Enter a valid household email address.")]))
    .default(""),
  phone: z.string().trim().max(40, "Household phone number is too long.").default(""),
  address: z.string().trim().max(240),
  postalCode: z.string().trim().max(20),
  city: z.string().trim().max(120),
  country: z.string().trim().max(120),
  status: z.enum(["active", "inactive"]),
  statusNote: z.string().trim().max(2000),
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
  gender: "male" | "female";
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  preferred_language: string | null;
  communication_consent: number;
  communication_consent_updated_at: string | null;
  email: string | null;
  phone: string | null;
  status: MemberStatus;
  status_note: string | null;
  joined_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CommunicationRecipientRow extends MemberRow {
  household_name: string | null;
}

export interface HouseholdRow {
  id: string;
  name: string;
  head_member_id: string | null;
  email: string | null;
  phone: string | null;
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

export interface HouseholdMemberRow {
  id: string;
  full_name: string;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  status: MemberStatus;
  role: "head" | "partner" | "child";
  valid_from: string;
  valid_until: string | null;
  date_of_birth: string | null;
}

export interface HouseholdAuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  detail: string | null;
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

export interface MemberConsentHistoryRow {
  id: number;
  changed_at: string;
  changed_by: string;
  consent_from: number | null;
  consent_to: number | null;
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
  includeArchived?: boolean;
}

export const MEMBER_PAGE_SIZE = 25;

export type SaveMemberResult =
  | { ok: false; message: string }
  | { ok: true; id: string; message: string };
export type SaveEntityResult =
  | { ok: false; message: string }
  | { ok: true; id: string; message: string };

function householdNameKey(name: string) {
  return name.trim().replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function isHouseholdNameConflict(error: unknown) {
  return error instanceof Error && error.message.includes("uq_households_name_normalized");
}

function householdNameConflictMessage(suggestedName?: string) {
  return suggestedName
    ? `A household with that name already exists. Try "${suggestedName}" if it is not already in use, or choose another unique name.`
    : "A household with that name already exists. Choose another unique name.";
}

export async function listMembers(db: D1Database, filters: MemberFilters) {
  const where: string[] = [
    filters.includeArchived ? "1 = 1" : "archived_at IS NULL",
  ];
  const binds: string[] = [];
  const q = filters.q.trim();
  if (q) {
    where.push(
      "(full_name LIKE ? OR preferred_name LIKE ? OR first_name LIKE ? OR middle_name LIKE ? OR family_name LIKE ? OR email LIKE ? OR phone LIKE ?)",
    );
    const like = `%${q}%`;
    binds.push(like, like, like, like, like, like, like);
  }
  if (
    filters.status === "active" ||
    filters.status === "inactive" ||
    filters.status === "moved" ||
    filters.status === "deceased"
  ) {
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
              communication_consent_updated_at, joined_on, created_at, updated_at
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

export interface ImportMembersResult {
  ok: boolean;
  imported: number;
  errors: number;
  message: string;
  errorRows: { row: number; message: string }[];
}

export async function exportMembers(
  db: D1Database,
  filters: Pick<MemberFilters, "q" | "status" | "includeArchived">,
): Promise<MemberRow[]> {
  const where: string[] = [filters.includeArchived ? "1 = 1" : "archived_at IS NULL"];
  const binds: string[] = [];
  const q = filters.q.trim();
  if (q) {
    where.push(
      "(full_name LIKE ? OR preferred_name LIKE ? OR first_name LIKE ? OR middle_name LIKE ? OR family_name LIKE ? OR email LIKE ? OR phone LIKE ?)",
    );
    const like = `%${q}%`;
    binds.push(like, like, like, like, like, like, like);
  }
  if (
    filters.status === "active" ||
    filters.status === "inactive" ||
    filters.status === "moved" ||
    filters.status === "deceased"
  ) {
    where.push("status = ?");
    binds.push(filters.status);
  }
  const clause = where.join(" AND ");
  const { results } = await db
    .prepare(
      `SELECT id, full_name, preferred_name, first_name, middle_name, family_name,
              date_of_birth, gender, address, postal_code, city, country,
              preferred_language, communication_consent, email, phone, status, status_note,
              communication_consent_updated_at, joined_on, notes, created_at, updated_at,
              archived_at
       FROM members WHERE ${clause} ORDER BY full_name COLLATE NOCASE, id`,
    )
    .bind(...binds)
    .all<MemberRow>();
  return results;
}

const MEMBER_EXPORT_COLUMNS: { header: string; value: (member: MemberRow) => string }[] = [
  { header: "ID", value: (m) => m.id },
  { header: "Full Name", value: (m) => m.full_name },
  { header: "Preferred Name", value: (m) => m.preferred_name ?? "" },
  { header: "First Name", value: (m) => m.first_name ?? "" },
  { header: "Middle Name", value: (m) => m.middle_name ?? "" },
  { header: "Family Name", value: (m) => m.family_name ?? "" },
  { header: "Date of Birth", value: (m) => m.date_of_birth ?? "" },
  { header: "Gender", value: (m) => m.gender },
  { header: "Address", value: (m) => m.address ?? "" },
  { header: "Postal Code", value: (m) => m.postal_code ?? "" },
  { header: "City", value: (m) => m.city ?? "" },
  { header: "Country", value: (m) => m.country ?? "" },
  { header: "Preferred Language", value: (m) => m.preferred_language ?? "" },
  { header: "Communication Consent", value: (m) => (m.communication_consent ? "TRUE" : "FALSE") },
  { header: "Consent Updated At", value: (m) => m.communication_consent_updated_at ?? "" },
  { header: "Email", value: (m) => m.email ?? "" },
  { header: "Phone", value: (m) => m.phone ?? "" },
  { header: "Status", value: (m) => m.status },
  { header: "Status Note", value: (m) => m.status_note ?? "" },
  { header: "Joined On", value: (m) => m.joined_on ?? "" },
  { header: "Notes", value: (m) => m.notes ?? "" },
  { header: "Created At", value: (m) => m.created_at },
  { header: "Updated At", value: (m) => m.updated_at },
  { header: "Archived At", value: (m) => m.archived_at ?? "" },
];

function memberExportRows(members: MemberRow[]): string[][] {
  return [
    MEMBER_EXPORT_COLUMNS.map(({ header }) => header),
    ...members.map((member) => MEMBER_EXPORT_COLUMNS.map(({ value }) => value(member))),
  ];
}

function csvCell(value: string): string {
  const safeValue = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[,"\r\n]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

export function membersToCsv(members: MemberRow[]): string {
  return memberExportRows(members).map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function communicationRecipientsToCsv(members: MemberRow[]): string {
  const rows = [
    ["Full Name", "Preferred Name", "Email", "Phone", "Status"],
    ...members.map((member) => [
      member.full_name,
      member.preferred_name ?? "",
      member.email ?? "",
      member.phone ?? "",
      member.status,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function xmlEscape(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function spreadsheetColumn(index: number): string {
  let column = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }
  return column;
}

export function membersToXlsx(members: MemberRow[]): Uint8Array {
  const rows = memberExportRows(members);
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map(
            (value, columnIndex) =>
              `<c r="${spreadsheetColumn(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  const files = {
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        "</Types>",
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    ),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Members" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        "</Relationships>",
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        sheetRows +
        "</sheetData></worksheet>",
    ),
  };
  return zipSync(files, { level: 6 });
}

export async function importMembersCsv(
  db: D1Database,
  actor: string,
  csvText: string,
): Promise<ImportMembersResult> {
  const parsedCsv = Papa.parse<string[]>(csvText.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
  });
  if (parsedCsv.errors.length) {
    return {
      ok: false,
      imported: 0,
      errors: parsedCsv.errors.length,
      message: "The CSV file could not be parsed.",
      errorRows: parsedCsv.errors.map((error) => ({
        row: error.row ?? 0,
        message: error.message,
      })),
    };
  }
  const rows = parsedCsv.data;
  if (rows.length <= 1) {
    return { ok: true, imported: 0, errors: 0, message: "No rows found in CSV.", errorRows: [] };
  }

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const headerIndex: Record<string, number> = {};
  headers.forEach((h, i) => {
    headerIndex[h] = i;
  });

  const get = (row: string[], key: string): string => {
    const idx = headerIndex[key];
    return idx !== undefined ? row[idx]?.trim() ?? "" : "";
  };

  const now = new Date().toISOString();
  let imported = 0;
  let errors = 0;
  const errorRows: { row: number; message: string }[] = [];
  const seenMembers = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const fullName = get(row, "full name") || get(row, "full_name") || "";
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const firstName =
      get(row, "first name") || get(row, "first_name") || nameParts[0] || "";
    const familyName =
      get(row, "family name") ||
      get(row, "family_name") ||
      nameParts.slice(1).join(" ");
    const email = get(row, "email") || "";
    const gender = (get(row, "gender") || "male").toLowerCase();
    const status = (get(row, "status") || "active").toLowerCase();
    const commConsent = get(row, "communication consent") || get(row, "communication_consent") || "false";

    let computedFullName = fullName;
    if (!computedFullName && (firstName || familyName)) {
      computedFullName = [firstName, familyName].filter(Boolean).join(" ");
    }

    if (gender !== "male" && gender !== "female") {
      errors++;
      errorRows.push({ row: i, message: "Gender must be male or female." });
      continue;
    }
    if (
      status !== "active" &&
      status !== "inactive" &&
      status !== "moved" &&
      status !== "deceased"
    ) {
      errors++;
      errorRows.push({ row: i, message: "Status is invalid." });
      continue;
    }
    if (!["true", "false", "1", "0", "yes", "no"].includes(commConsent.toLowerCase())) {
      errors++;
      errorRows.push({ row: i, message: "Communication consent must be true or false." });
      continue;
    }

    const memberSchema = {
      fullName: computedFullName || "Unknown",
      preferredName: get(row, "preferred name") || get(row, "preferred_name") || "",
      firstName,
      middleName: get(row, "middle name") || get(row, "middle_name") || "",
      familyName,
      dateOfBirth: get(row, "date of birth") || get(row, "date_of_birth") || "",
      gender: gender === "female" ? "female" : "male",
      address: get(row, "address") || "",
      postalCode: get(row, "postal code") || get(row, "postal_code") || "",
      city: get(row, "city") || "",
      country: get(row, "country") || "",
      preferredLanguage: get(row, "preferred language") || get(row, "preferred_language") || "",
      communicationConsent: ["true", "1", "yes"].includes(commConsent.toLowerCase()),
      email,
      phone: get(row, "phone") || "",
      status,
      statusNote: get(row, "status note") || get(row, "status_note") || "",
      joinedOn: get(row, "joined on") || get(row, "joined_on") || "",
      notes: get(row, "notes") || "",
    };

    // Validate required fields
    if (!computedFullName) {
      errors++;
      errorRows.push({ row: i, message: "Full name is required" });
      continue;
    }

    // Validate email if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors++;
      errorRows.push({ row: i, message: "Invalid email format" });
      continue;
    }

    if (email) {
      const normalizedEmail = email.toLowerCase();
      const normalizedName = computedFullName.trim().toLowerCase().replace(/\s+/g, " ");
      const duplicateKey = `${normalizedEmail}\u0000${normalizedName}`;
      if (seenMembers.has(duplicateKey)) {
        errors++;
        errorRows.push({ row: i, message: "A member with this name and email is repeated in this file." });
        continue;
      }
      seenMembers.add(duplicateKey);
      const existing = await db
        .prepare("SELECT id FROM members WHERE lower(email) = ? AND lower(full_name) = ? LIMIT 1")
        .bind(normalizedEmail, normalizedName)
        .first<{ id: string }>();
      if (existing) {
        errors++;
        errorRows.push({ row: i, message: "A member with this name and email already exists." });
        continue;
      }
    }

    try {
      const result = await saveMember(db, actor, memberSchema);
      if (result.ok) {
        imported++;
        await db
          .prepare(
            "INSERT INTO audit_log (at, actor, action, target, detail) VALUES (?, ?, 'member.import', ?, ?)",
          )
          .bind(
            now,
            actor,
            result.id,
            JSON.stringify({ source: "csv", row: i }),
          )
          .run();
      } else {
        errors++;
        errorRows.push({ row: i, message: result.message });
      }
    } catch (e) {
      errors++;
      errorRows.push({ row: i, message: e instanceof Error ? e.message : "Unknown error" });
    }
  }

  return {
    ok: imported > 0 || errors === 0,
    imported,
    errors,
    message: `Imported ${imported} member(s).${errors > 0 ? ` ${errors} error(s).` : ""}`,
    errorRows,
  };
}

export async function getMember(
  db: D1Database,
  id: string,
  includeArchived = false,
) {
  const statement = includeArchived
    ? db.prepare("SELECT * FROM members WHERE id = ?").bind(id)
    : db
        .prepare("SELECT * FROM members WHERE id = ? AND archived_at IS NULL")
        .bind(id);
  return statement.first<MemberRow & { notes: string | null }>();
}

export async function getMemberProfile(db: D1Database, id: string) {
  const [member, household, groups, relationships, history, consentHistory, assignmentHistory] =
    await Promise.all([
      getMember(db, id, true),
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
         FROM member_group_memberships mg JOIN groups g ON g.id = mg.group_id
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
        .prepare(
          "SELECT * FROM member_history WHERE member_id = ? ORDER BY changed_at DESC, id DESC LIMIT 50",
        )
        .bind(id)
        .all<MemberHistoryRow>(),
      db
        .prepare(
          `SELECT id, changed_at, changed_by,
                  CAST(json_extract(changes_json, '$.communication_consent.from') AS INTEGER) AS consent_from,
                  CAST(json_extract(changes_json, '$.communication_consent.to') AS INTEGER) AS consent_to
           FROM member_history
           WHERE member_id = ? AND json_type(changes_json, '$.communication_consent') = 'object'
           ORDER BY changed_at DESC, id DESC`,
        )
        .bind(id)
        .all<MemberConsentHistoryRow>(),
      db
        .prepare(
          `SELECT 'Household' AS kind, h.name AS label, mh.role, mh.valid_from, mh.valid_until,
                mh.assigned_by AS changed_by, mh.ended_by
         FROM member_households mh JOIN households h ON h.id = mh.household_id
         WHERE mh.member_id = ?
         UNION ALL
         SELECT 'Group' AS kind, g.name AS label, mg.role, mg.valid_from, mg.valid_until,
                mg.assigned_by AS changed_by, mg.ended_by
         FROM member_group_memberships mg JOIN groups g ON g.id = mg.group_id
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
    consentHistory: consentHistory.results,
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

export async function getHouseholdDetail(db: D1Database, id: string) {
  const household = await db
    .prepare("SELECT * FROM households WHERE id = ?")
    .bind(id)
    .first<HouseholdRow>();
  if (!household) return null;

  const [current, history, audit] = await Promise.all([
    db
      .prepare(
        `SELECT m.id, m.full_name, m.preferred_name, m.email, m.phone, m.status,
                m.date_of_birth, mh.role, mh.valid_from, mh.valid_until
         FROM member_households mh
         JOIN members m ON m.id = mh.member_id
         WHERE mh.household_id = ? AND mh.valid_until IS NULL
         ORDER BY CASE mh.role WHEN 'head' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END,
                  m.full_name COLLATE NOCASE`,
      )
      .bind(id)
      .all<HouseholdMemberRow>(),
    db
      .prepare(
        `SELECT m.id, m.full_name, m.preferred_name, m.email, m.phone, m.status,
                m.date_of_birth, mh.role, mh.valid_from, mh.valid_until
         FROM member_households mh
         JOIN members m ON m.id = mh.member_id
         WHERE mh.household_id = ? AND mh.valid_until IS NOT NULL
         ORDER BY mh.valid_until DESC, m.full_name COLLATE NOCASE`,
      )
      .bind(id)
      .all<HouseholdMemberRow>(),
    db
      .prepare(
        "SELECT id, at, actor, action, detail FROM audit_log WHERE target = ? ORDER BY id DESC LIMIT 50",
      )
      .bind(id)
      .all<HouseholdAuditRow>(),
  ]);

  return {
    household,
    currentMembers: current.results,
    formerMembers: history.results,
    audit: audit.results,
  };
}

export async function listGroups(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT g.*, COUNT(mg.member_id) AS member_count FROM groups g
       LEFT JOIN member_group_memberships mg ON mg.group_id = g.id AND mg.valid_until IS NULL
       GROUP BY g.id ORDER BY g.name COLLATE NOCASE`,
    )
    .all<GroupRow>();
  return results;
}

export async function listActiveMembers(db: D1Database, exceptId?: string) {
  const statement = exceptId
    ? db
        .prepare(
          "SELECT id, full_name FROM members WHERE archived_at IS NULL AND status = 'active' AND id <> ? ORDER BY full_name COLLATE NOCASE",
        )
        .bind(exceptId)
    : db.prepare(
        "SELECT id, full_name FROM members WHERE archived_at IS NULL AND status = 'active' ORDER BY full_name COLLATE NOCASE",
      );
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
  householdRole = "partner",
  newHousehold?: {
    name: string;
    email?: string;
    phone?: string;
    address: string;
    postalCode: string;
    city: string;
    country: string;
    additionalMembers: { role: string; member: unknown }[];
  },
): Promise<SaveMemberResult> {
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Member data is invalid.",
    };
  const value = parsed.data;
  const generatedFullName = [
    value.firstName,
    value.middleName,
    value.familyName,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (generatedFullName) value.fullName = generatedFullName;
  const timestamp = now.toISOString();
  const uniqueGroupIds = [...new Set(groupIds.filter(Boolean))];
  let householdDetails: z.infer<typeof householdSchema> | null = null;
  const additionalMembers: { role: "partner" | "child"; member: MemberInput }[] = [];
  if (newHousehold) {
    if (id || householdId || householdRole !== "head") {
      return { ok: false, message: "A new household can only be created with a new head member." };
    }
    if (newHousehold.additionalMembers.length > 8) {
      return { ok: false, message: "A household can include up to 8 additional members at a time." };
    }
    const parsedHousehold = householdSchema.safeParse({
      ...newHousehold,
      status: "active",
      statusNote: "",
    });
    if (!parsedHousehold.success) {
      return {
        ok: false,
        message: parsedHousehold.error.issues[0]?.message ?? "Household data is invalid.",
      };
    }
    householdDetails = parsedHousehold.data;
    let partnerCount = 0;
    for (const [index, additional] of newHousehold.additionalMembers.entries()) {
      if (additional.role !== "partner" && additional.role !== "child") {
        return { ok: false, message: `Choose partner or child for household member ${index + 1}.` };
      }
      if (additional.role === "partner") partnerCount++;
      const parsedAdditional = memberSchema.safeParse(additional.member);
      if (!parsedAdditional.success) {
        return {
          ok: false,
          message: `Household member ${index + 1}: ${parsedAdditional.error.issues[0]?.message ?? "Member data is invalid."}`,
        };
      }
      const additionalValue = parsedAdditional.data;
      if (
        additionalValue.communicationConsent &&
        !additionalValue.email &&
        !additionalValue.phone
      ) {
        return {
          ok: false,
          message: `Household member ${index + 1}: communication consent requires an email address or phone number.`,
        };
      }
      const additionalFullName = [
        additionalValue.firstName,
        additionalValue.middleName,
        additionalValue.familyName,
      ].filter(Boolean).join(" ").trim();
      if (additionalFullName) additionalValue.fullName = additionalFullName;
      additionalMembers.push({ role: additional.role, member: additionalValue });
    }
    if (partnerCount > 1) {
      return { ok: false, message: "A household can have only one partner." };
    }
  }

  const assignedHouseholdId = householdDetails ? crypto.randomUUID() : householdId;
  const [member, households, allGroups] = await Promise.all([
    id ? getMember(db, id) : Promise.resolve(null),
    listHouseholds(db),
    listGroups(db),
  ]);
  if (id && !member) return { ok: false, message: "Member not found." };
  const requestedHouseholdName = householdDetails?.name;
  if (
    requestedHouseholdName &&
    households.some(
      (household) =>
        householdNameKey(household.name) === householdNameKey(requestedHouseholdName),
    )
  ) {
    return {
      ok: false,
      message: householdNameConflictMessage(
        [value.firstName, value.familyName].filter(Boolean).join(" "),
      ),
    };
  }
  if (assignedHouseholdId && !householdDetails && !households.some((h) => h.id === assignedHouseholdId)) {
    return { ok: false, message: "The selected household was not found." };
  }
  if (assignedHouseholdId && !householdDetails) {
    const household = households.find((item) => item.id === assignedHouseholdId);
    if (household?.status !== "active") {
      return {
        ok: false,
        message: "Members can only be assigned to an active household.",
      };
    }
    if (!["head", "partner", "child"].includes(householdRole)) {
      return { ok: false, message: "Select a valid household role." };
    }
  }
  if (assignedHouseholdId && !householdDetails && householdRole === "partner") {
    const partner = await db
      .prepare(
        `SELECT member_id FROM member_households
         WHERE household_id = ? AND role = 'partner' AND valid_until IS NULL AND member_id <> ?`,
      )
      .bind(assignedHouseholdId, id ?? "")
      .first<{ member_id: string }>();
    if (partner)
      return { ok: false, message: "This household already has one partner." };
  }
  if (assignedHouseholdId && !householdDetails && householdRole === "head") {
    const head = await db
      .prepare(
        `SELECT member_id FROM member_households
         WHERE household_id = ? AND role = 'head' AND valid_until IS NULL AND member_id <> ?`,
      )
      .bind(assignedHouseholdId, id ?? "")
      .first<{ member_id: string }>();
    if (head)
      return { ok: false, message: "This household already has one head." };
  }
  if (
    uniqueGroupIds.some(
      (groupId) => !allGroups.some((group) => group.id === groupId),
    )
  ) {
    return { ok: false, message: "One of the selected groups was not found." };
  }
  for (const role of Object.values(groupRoles)) {
    if (!z.string().trim().max(80).safeParse(role).success) {
      return {
        ok: false,
        message: "Group roles must be 80 characters or fewer.",
      };
    }
  }

  const memberId = id ?? crypto.randomUUID();
  const previousConsent = member?.communication_consent === 1;
  const consentChanged = member
    ? previousConsent !== value.communicationConsent
    : value.communicationConsent;
  const consentUpdatedAt = consentChanged
    ? timestamp
    : (member?.communication_consent_updated_at ?? null);
  const changes = member
    ? diffMember(member, value, consentUpdatedAt)
    : initialMemberChanges(value, consentUpdatedAt);

  const statements: D1PreparedStatement[] = [];
  if (householdDetails) {
    statements.push(
      db.prepare(
        `INSERT INTO households (id, name, email, phone, address, postal_code, city, country, status, status_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        assignedHouseholdId,
        householdDetails.name,
        householdDetails.email || null,
        householdDetails.phone || null,
        householdDetails.address || null,
        householdDetails.postalCode || null,
        householdDetails.city || null,
        householdDetails.country || null,
        householdDetails.status,
        householdDetails.statusNote || null,
        timestamp,
        timestamp,
      ),
      auditStatement(db, actor, "household.create", assignedHouseholdId, {
        name: householdDetails.name,
        status: householdDetails.status,
        statusNote: householdDetails.statusNote || null,
      }, timestamp),
    );
  }
  if (member) {
    statements.push(
      db
        .prepare(
          `UPDATE members SET
             full_name = ?, preferred_name = ?, first_name = ?, middle_name = ?, family_name = ?,
             date_of_birth = ?, gender = ?, address = ?, postal_code = ?, city = ?, country = ?,
             preferred_language = ?, communication_consent = ?, email = ?, phone = ?, status = ?,
             communication_consent_updated_at = ?, status_note = ?, joined_on = ?, notes = ?, updated_at = ?
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
          consentUpdatedAt,
          value.statusNote || null,
          value.joinedOn || null,
          value.notes || null,
          timestamp,
          memberId,
        ),
    );
  } else {
    statements.push(memberInsertStatement(db, memberId, value, timestamp, consentUpdatedAt));
  }

  if (Object.keys(changes).length) {
    statements.push(
      db
        .prepare(
          "INSERT INTO member_history (member_id, changed_at, changed_by, changes_json) VALUES (?, ?, ?, ?)",
        )
        .bind(memberId, timestamp, actor, JSON.stringify(changes)),
    );
  }
  statements.push(
    ...(await householdAssignmentStatements(
      db,
      actor,
      memberId,
      assignedHouseholdId,
      householdRole,
      timestamp,
    )),
  );
  statements.push(
    ...(await groupAssignmentStatements(
      db,
      actor,
      memberId,
      uniqueGroupIds,
      groupRoles,
      timestamp,
    )),
  );
  if (Object.keys(changes).length || !member) {
    statements.push(
      auditStatement(
        db,
        actor,
        member ? "member.update" : "member.create",
        memberId,
        { fields: Object.keys(changes) },
        timestamp,
      ),
    );
  }
  for (const additional of additionalMembers) {
    const additionalId = crypto.randomUUID();
    const additionalConsentUpdatedAt = additional.member.communicationConsent ? timestamp : null;
    const additionalChanges = initialMemberChanges(additional.member, additionalConsentUpdatedAt);
    statements.push(
      memberInsertStatement(db, additionalId, additional.member, timestamp, additionalConsentUpdatedAt),
      db.prepare(
        "INSERT INTO member_history (member_id, changed_at, changed_by, changes_json) VALUES (?, ?, ?, ?)",
      ).bind(additionalId, timestamp, actor, JSON.stringify(additionalChanges)),
      ...(await householdAssignmentStatements(
        db,
        actor,
        additionalId,
        assignedHouseholdId,
        additional.role,
        timestamp,
      )),
      auditStatement(db, actor, "member.create", additionalId, {
        fields: Object.keys(additionalChanges),
      }, timestamp),
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (isHouseholdNameConflict(error)) {
      return {
        ok: false,
        message: householdNameConflictMessage(
          [value.firstName, value.familyName].filter(Boolean).join(" "),
        ),
      };
    }
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed: member_households.")
    ) {
      return {
        ok: false,
        message: "A household assignment changed while saving. Refresh and try again.",
      };
    }
    throw error;
  }
  return {
    ok: true,
    id: memberId,
    message: member ? "Member changes saved." : "Member added.",
  };
}

function diffMember(
  member: MemberRow,
  value: MemberInput,
  consentUpdatedAt: string | null,
) {
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
    preferred_language: [
      member.preferred_language,
      value.preferredLanguage || null,
    ],
    communication_consent: [
      member.communication_consent,
      value.communicationConsent ? 1 : 0,
    ],
    communication_consent_updated_at: [
      member.communication_consent_updated_at,
      consentUpdatedAt,
    ],
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

function initialMemberChanges(value: MemberInput, consentUpdatedAt: string | null) {
  return {
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
    communication_consent: {
      from: null,
      to: value.communicationConsent ? 1 : 0,
    },
    communication_consent_updated_at: {
      from: null,
      to: consentUpdatedAt,
    },
    email: { from: null, to: value.email || null },
    phone: { from: null, to: value.phone || null },
    status: { from: null, to: value.status },
    status_note: { from: null, to: value.statusNote || null },
    joined_on: { from: null, to: value.joinedOn || null },
    notes: { from: null, to: value.notes || null },
  };
}

function memberInsertStatement(
  db: D1Database,
  memberId: string,
  value: MemberInput,
  timestamp: string,
  consentUpdatedAt: string | null,
) {
  return db.prepare(
    `INSERT INTO members
     (id, full_name, preferred_name, first_name, middle_name, family_name,
      date_of_birth, gender, address, postal_code, city, country,
      preferred_language, communication_consent, email, phone, status, status_note,
      communication_consent_updated_at, joined_on, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
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
    consentUpdatedAt,
    value.joinedOn || null,
    value.notes || null,
    timestamp,
    timestamp,
  );
}

async function householdAssignmentStatements(
  db: D1Database,
  actor: string,
  memberId: string,
  householdId: string,
  householdRole: string,
  timestamp: string,
) {
  const current = await db
    .prepare(
      "SELECT household_id, role FROM member_households WHERE member_id = ? AND valid_until IS NULL",
    )
    .bind(memberId)
    .first<{ household_id: string; role: string }>();
  const normalizedRole = householdRole;
  if (
    (current?.household_id ?? "") === householdId &&
    current?.role === normalizedRole
  )
    return [];
  const statements: D1PreparedStatement[] = [];
  if (current) {
    statements.push(
      db
        .prepare(
          "UPDATE member_households SET valid_until = ?, ended_by = ? WHERE member_id = ? AND valid_until IS NULL",
        )
        .bind(timestamp, actor, memberId),
    );
  }
  if (householdId) {
    if (normalizedRole === "head") {
      const existingPartner = await db
        .prepare(
          "SELECT member_id FROM member_households WHERE household_id = ? AND role = 'partner' AND valid_until IS NULL",
        )
        .bind(householdId)
        .first<{ member_id: string }>();
      const oldHeadChange = existingPartner
        ? db
            .prepare(
              "UPDATE member_households SET valid_until = ?, ended_by = ? WHERE household_id = ? AND member_id <> ? AND role = 'head' AND valid_until IS NULL",
            )
            .bind(timestamp, actor, householdId, memberId)
        : db
            .prepare(
              "UPDATE member_households SET role = 'partner' WHERE household_id = ? AND member_id <> ? AND role = 'head' AND valid_until IS NULL",
            )
            .bind(householdId, memberId);
      statements.push(
        oldHeadChange,
        db
          .prepare(
            "INSERT INTO member_households (member_id, household_id, role, assigned_by, valid_from) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(memberId, householdId, normalizedRole, actor, timestamp),
        db
          .prepare("UPDATE households SET updated_at = ? WHERE id = ?")
          .bind(timestamp, householdId),
      );
    } else if (
      current?.household_id === householdId &&
      current.role === "head"
    ) {
      statements.push(
        db
          .prepare(
            "UPDATE households SET head_member_id = NULL, updated_at = ? WHERE id = ?",
          )
          .bind(timestamp, householdId),
      );
      statements.push(
        db
          .prepare(
            "INSERT INTO member_households (member_id, household_id, role, assigned_by, valid_from) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(memberId, householdId, normalizedRole, actor, timestamp),
      );
    } else {
      statements.push(
        db
          .prepare(
            "INSERT INTO member_households (member_id, household_id, role, assigned_by, valid_from) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(memberId, householdId, normalizedRole, actor, timestamp),
      );
    }
  } else if (current?.role === "head") {
    statements.push(
      db
        .prepare(
          "UPDATE households SET head_member_id = NULL, updated_at = ? WHERE id = ?",
        )
        .bind(timestamp, current.household_id),
    );
  }
  statements.push(
    auditStatement(
      db,
      actor,
      "member.household.change",
      memberId,
      {
        from: current?.household_id ?? null,
        to: householdId || null,
      },
      timestamp,
    ),
  );
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
    .prepare(
      "SELECT group_id, role FROM member_group_memberships WHERE member_id = ? AND valid_until IS NULL",
    )
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
          .prepare(
            "UPDATE member_group_memberships SET valid_until = ?, ended_by = ? WHERE member_id = ? AND group_id = ? AND valid_until IS NULL",
          )
          .bind(timestamp, actor, memberId, groupId),
      );
    }
  }
  for (const groupId of nextIds) {
    const nextRole = groupRoles[groupId]?.trim() || "member";
    if (!currentIds.has(groupId) || currentById.get(groupId) !== nextRole) {
      statements.push(
        db
          .prepare(
            "INSERT INTO member_group_memberships (member_id, group_id, role, assigned_by, valid_from) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(memberId, groupId, nextRole, actor, timestamp),
      );
    }
  }
  const added = [...nextIds].filter((groupId) => !currentIds.has(groupId));
  const removed = [...currentIds].filter((groupId) => !nextIds.has(groupId));
  const roleChanges = [...nextIds]
    .filter(
      (groupId) =>
        currentIds.has(groupId) &&
        currentById.get(groupId) !== (groupRoles[groupId]?.trim() || "member"),
    )
    .map((groupId) => ({
      groupId,
      from: currentById.get(groupId),
      to: groupRoles[groupId]?.trim() || "member",
    }));
  if (added.length || removed.length || roleChanges.length) {
    statements.push(
      auditStatement(
        db,
        actor,
        "member.groups.change",
        memberId,
        { added, removed, roleChanges },
        timestamp,
      ),
    );
  }
  return statements;
}

export async function saveHousehold(
  db: D1Database,
  actor: string,
  input: {
    name: string;
    email?: string;
    phone?: string;
    address: string;
    postalCode: string;
    city: string;
    country: string;
    status: string;
    statusNote: string;
  },
  id?: string,
  now = new Date(),
): Promise<SaveEntityResult> {
  const parsed = householdSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Household data is invalid.",
    };
  const householdId = id ?? crypto.randomUUID();
  if (
    id &&
    !(await db
      .prepare("SELECT 1 FROM households WHERE id = ?")
      .bind(id)
      .first())
  ) {
    return { ok: false, message: "Household not found." };
  }
  const duplicate = await db
    .prepare(
      "SELECT 1 FROM households WHERE lower(trim(name)) = lower(trim(?)) AND (? IS NULL OR id <> ?)",
    )
    .bind(parsed.data.name, id ?? null, id ?? null)
    .first();
  if (duplicate) {
    return { ok: false, message: householdNameConflictMessage() };
  }
  const timestamp = now.toISOString();
  const { name, email, phone, address, postalCode, city, country, status, statusNote } =
    parsed.data;
  try {
    await db.batch(
      id
        ? [
            db
              .prepare(
                "UPDATE households SET name = ?, email = ?, phone = ?, address = ?, postal_code = ?, city = ?, country = ?, status = ?, status_note = ?, updated_at = ? WHERE id = ?",
              )
              .bind(
                name,
                email || null,
                phone || null,
                address || null,
                postalCode || null,
                city || null,
                country || null,
                status,
                statusNote || null,
                timestamp,
                id,
              ),
            auditStatement(
              db,
              actor,
              "household.update",
              id,
              { name, status, statusNote: statusNote || null },
              timestamp,
            ),
          ]
        : [
            db
              .prepare(
                `INSERT INTO households (id, name, email, phone, address, postal_code, city, country, status, status_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                householdId,
                name,
                email || null,
                phone || null,
                address || null,
                postalCode || null,
                city || null,
                country || null,
                status,
                statusNote || null,
                timestamp,
                timestamp,
              ),
            auditStatement(
              db,
              actor,
              "household.create",
              householdId,
              { name, status, statusNote: statusNote || null },
              timestamp,
            ),
          ],
    );
  } catch (error) {
    if (isHouseholdNameConflict(error)) {
      return { ok: false, message: householdNameConflictMessage() };
    }
    throw error;
  }
  return {
    ok: true,
    id: householdId,
    message: id ? "Household updated." : "Household added.",
  };
}

export async function saveGroup(
  db: D1Database,
  actor: string,
  input: { name: string; description: string },
  id?: string,
  now = new Date(),
): Promise<SaveEntityResult> {
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Group name is required.").max(120),
      description: z.string().trim().max(500),
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Group data is invalid.",
    };
  const { name, description } = parsed.data;
  const duplicate = await db
    .prepare(
      "SELECT 1 FROM groups WHERE name = ? COLLATE NOCASE AND (? IS NULL OR id <> ?)",
    )
    .bind(name, id ?? null, id ?? null)
    .first();
  if (duplicate)
    return { ok: false, message: "That group name is already in use." };
  if (
    id &&
    !(await db.prepare("SELECT 1 FROM groups WHERE id = ?").bind(id).first())
  ) {
    return { ok: false, message: "Group not found." };
  }
  const groupId = id ?? crypto.randomUUID();
  const timestamp = now.toISOString();
  await db.batch(
    id
      ? [
          db
            .prepare(
              "UPDATE groups SET name = ?, description = ?, updated_at = ? WHERE id = ?",
            )
            .bind(name, description || null, timestamp, id),
          auditStatement(db, actor, "group.update", id, { name }, timestamp),
        ]
      : [
          db
            .prepare(
              "INSERT INTO groups (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(groupId, name, description || null, timestamp, timestamp),
          auditStatement(
            db,
            actor,
            "group.create",
            groupId,
            { name },
            timestamp,
          ),
        ],
  );
  return {
    ok: true,
    id: groupId,
    message: id ? "Group updated." : "Group added.",
  };
}

export async function addMemberRelationship(
  db: D1Database,
  actor: string,
  memberId: string,
  relatedMemberId: string,
  relationship: string,
  now = new Date(),
) {
  const parsed = z
    .object({
      memberId: z.string().min(1),
      relatedMemberId: z.string().min(1),
      relationship: z
        .string()
        .trim()
        .min(1, "Relationship type is required.")
        .max(80),
    })
    .safeParse({ memberId, relatedMemberId, relationship });
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Relationship is invalid.",
    };
  if (parsed.data.memberId === parsed.data.relatedMemberId) {
    return {
      ok: false,
      message: "A member cannot have a relationship with themselves.",
    };
  }
  const { results } = await db
    .prepare(
      "SELECT id FROM members WHERE archived_at IS NULL AND id IN (?, ?)",
    )
    .bind(parsed.data.memberId, parsed.data.relatedMemberId)
    .all<{ id: string }>();
  if (results.length !== 2)
    return { ok: false, message: "One of the selected members was not found." };
  const duplicate = await db
    .prepare(
      `SELECT 1 FROM member_relationships
       WHERE member_id = ? AND related_member_id = ? AND relationship = ? AND valid_until IS NULL`,
    )
    .bind(
      parsed.data.memberId,
      parsed.data.relatedMemberId,
      parsed.data.relationship,
    )
    .first();
  if (duplicate)
    return { ok: false, message: "That relationship is already recorded." };
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO member_relationships (id, member_id, related_member_id, relationship, created_by, valid_from)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        parsed.data.memberId,
        parsed.data.relatedMemberId,
        parsed.data.relationship,
        actor,
        timestamp,
      ),
    auditStatement(
      db,
      actor,
      "member.relationship.add",
      parsed.data.memberId,
      {
        relationshipId: id,
        relatedMemberId: parsed.data.relatedMemberId,
        relationship: parsed.data.relationship,
      },
      timestamp,
    ),
  ]);
  return { ok: true, message: "Relationship added." };
}

export async function endMemberRelationship(
  db: D1Database,
  actor: string,
  memberId: string,
  relationshipId: string,
  now = new Date(),
) {
  const timestamp = now.toISOString();
  const result = await db.batch([
    db
      .prepare(
        "UPDATE member_relationships SET valid_until = ?, ended_by = ? WHERE id = ? AND member_id = ? AND valid_until IS NULL",
      )
      .bind(timestamp, actor, relationshipId, memberId),
    auditStatement(
      db,
      actor,
      "member.relationship.end",
      memberId,
      { relationshipId },
      timestamp,
    ),
  ]);
  if (!result[0]?.meta.changes)
    return { ok: false, message: "Relationship not found or already ended." };
  return { ok: true, message: "Relationship ended." };
}

export async function setMemberArchived(
  db: D1Database,
  actor: string,
  memberId: string,
  archived: boolean,
  now = new Date(),
) {
  const timestamp = now.toISOString();
  const member = await db
    .prepare("SELECT id, full_name, archived_at FROM members WHERE id = ?")
    .bind(memberId)
    .first<{ id: string; full_name: string; archived_at: string | null }>();
  if (!member) return { ok: false, message: "Member not found." };

  if (archived && member.archived_at)
    return { ok: false, message: "Member is already archived." };
  if (!archived && !member.archived_at)
    return { ok: false, message: "Member is not archived." };

  await db.batch([
    db
      .prepare(
        "UPDATE members SET archived_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(archived ? timestamp : null, timestamp, memberId),
    db
      .prepare(
        "INSERT INTO member_history (member_id, changed_at, changed_by, changes_json) VALUES (?, ?, ?, ?)",
      )
      .bind(
        memberId,
        timestamp,
        actor,
        JSON.stringify({ archived: { from: !archived, to: archived } }),
      ),
    auditStatement(
      db,
      actor,
      archived ? "member.archive" : "member.restore",
      memberId,
      { fullName: member.full_name },
      timestamp,
    ),
  ]);
  return {
    ok: true,
    message: archived ? "Member archived." : "Member restored.",
  };
}

export interface HouseholdLifecyclePreview {
  action:
    | "NO_ACTION"
    | "PROMOTE_PARTNER"
    | "PROMOTE_CHILD"
    | "DEACTIVATE_HOUSEHOLD"
    | "MANUAL_REVIEW";
  status: "ready" | "no_action";
  householdId: string;
  householdName: string;
  currentHeadId: string | null;
  replacementMemberId: string | null;
  candidateIds: string[];
  adultChildIds: string[];
  reason: string;
}

function ageOnDate(dateOfBirth: string | null, eventDate: Date): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  let age = eventDate.getUTCFullYear() - dob.getUTCFullYear();
  if (
    eventDate.getUTCMonth() < dob.getUTCMonth() ||
    (eventDate.getUTCMonth() === dob.getUTCMonth() &&
      eventDate.getUTCDate() < dob.getUTCDate())
  ) {
    age--;
  }
  return age;
}

function turnsAgeOnDate(
  dateOfBirth: string | null,
  eventDate: Date,
  age: number,
): boolean {
  if (!dateOfBirth) return false;
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return false;
  return (
    dob.getUTCMonth() === eventDate.getUTCMonth() &&
    dob.getUTCDate() === eventDate.getUTCDate() &&
    eventDate.getUTCFullYear() - dob.getUTCFullYear() === age
  );
}

export async function previewHouseholdLifecycle(
  db: D1Database,
  householdId: string,
  eventDate = new Date(),
): Promise<HouseholdLifecyclePreview> {
  const household = await db
    .prepare("SELECT * FROM households WHERE id = ?")
    .bind(householdId)
    .first<HouseholdRow>();
  if (!household) {
    throw new Error("Household not found.");
  }

  const { results: assignments } = await db
    .prepare(
      `SELECT m.id, m.full_name, m.date_of_birth, m.status, m.archived_at, mh.role
       FROM member_households mh
       JOIN members m ON m.id = mh.member_id
       WHERE mh.household_id = ? AND mh.valid_until IS NULL`,
    )
    .bind(householdId)
    .all<{
      id: string;
      full_name: string;
      date_of_birth: string | null;
      status: MemberStatus;
      archived_at: string | null;
      role: string;
    }>();

  let head = household.head_member_id
    ? assignments.find((member) => member.id === household.head_member_id)
    : assignments.find((member) => member.role === "head");
  if (!head) {
    const heads = assignments.filter((member) => member.role === "head");
    if (heads.length === 1) head = heads[0];
  }

  if (!head) {
    return {
      action: "MANUAL_REVIEW",
      status: "ready",
      householdId,
      householdName: household.name,
      currentHeadId: null,
      replacementMemberId: null,
      candidateIds: [],
      adultChildIds: [],
      reason: "The household has no identifiable head.",
    };
  }

  const active = (member: (typeof assignments)[number]) =>
    member.status === "active" && !member.archived_at;
  const partners = assignments.filter(
    (member) => member.role === "partner" && active(member),
  );
  const children = assignments.filter(
    (member) => member.role === "child" && active(member),
  );
  const adultChildIds = children
    .filter(
      (member) => (ageOnDate(member.date_of_birth, eventDate) ?? -1) >= 18,
    )
    .map((member) => member.id);

  if (household.status !== "active") {
    return {
      action: "NO_ACTION",
      status: "no_action",
      householdId,
      householdName: household.name,
      currentHeadId: head.id,
      replacementMemberId: null,
      candidateIds: [],
      adultChildIds,
      reason: "The household is not active.",
    };
  }
  if (head.status === "moved") {
    return {
      action: "NO_ACTION",
      status: "no_action",
      householdId,
      householdName: household.name,
      currentHeadId: head.id,
      replacementMemberId: null,
      candidateIds: [],
      adultChildIds,
      reason: "The head has moved.",
    };
  }
  if (head.status !== "deceased") {
    return {
      action: "NO_ACTION",
      status: "no_action",
      householdId,
      householdName: household.name,
      currentHeadId: head.id,
      replacementMemberId: null,
      candidateIds: [],
      adultChildIds,
      reason: "The head is not deceased.",
    };
  }
  if (partners.length > 1) {
    return {
      action: "MANUAL_REVIEW",
      status: "ready",
      householdId,
      householdName: household.name,
      currentHeadId: head.id,
      replacementMemberId: null,
      candidateIds: partners.map((member) => member.id),
      adultChildIds,
      reason: "Multiple active partners require manual selection.",
    };
  }
  if (partners.length === 1) {
    return {
      action: "PROMOTE_PARTNER",
      status: "ready",
      householdId,
      householdName: household.name,
      currentHeadId: head.id,
      replacementMemberId: partners[0].id,
      candidateIds: [partners[0].id],
      adultChildIds,
      reason: "An active partner is available to replace the deceased head.",
    };
  }
  const birthdayCandidates = children.filter((member) =>
    turnsAgeOnDate(member.date_of_birth, eventDate, 18),
  );
  if (birthdayCandidates.length > 1) {
    return {
      action: "MANUAL_REVIEW",
      status: "ready",
      householdId,
      householdName: household.name,
      currentHeadId: head.id,
      replacementMemberId: null,
      candidateIds: birthdayCandidates.map((member) => member.id),
      adultChildIds,
      reason: "Multiple children turn 18 on the effective date.",
    };
  }
  if (birthdayCandidates.length === 1) {
    return {
      action: "PROMOTE_CHILD",
      status: "ready",
      householdId,
      householdName: household.name,
      currentHeadId: head.id,
      replacementMemberId: birthdayCandidates[0].id,
      candidateIds: [birthdayCandidates[0].id],
      adultChildIds,
      reason: "A child turns 18 on the effective date.",
    };
  }
  return {
    action: "DEACTIVATE_HOUSEHOLD",
    status: "ready",
    householdId,
    householdName: household.name,
    currentHeadId: head.id,
    replacementMemberId: null,
    candidateIds: [],
    adultChildIds,
    reason: "No eligible partner or 18-year-old child replacement exists.",
  };
}

export async function processHouseholdLifecycle(
  db: D1Database,
  actor: string,
  householdId: string,
  eventDate = new Date(),
): Promise<{
  ok: boolean;
  message: string;
  preview?: HouseholdLifecyclePreview;
}> {
  const preview = await previewHouseholdLifecycle(db, householdId, eventDate);
  if (preview.status === "no_action") {
    return { ok: true, preview, message: preview.reason };
  }
  if (preview.action === "MANUAL_REVIEW") {
    return { ok: false, preview, message: preview.reason };
  }

  const timestamp = eventDate.toISOString();
  const statements: D1PreparedStatement[] = [];
  const household = await db
    .prepare(
      "SELECT name, address, postal_code, city, country FROM households WHERE id = ?",
    )
    .bind(householdId)
    .first<{
      name: string;
      address: string | null;
      postal_code: string | null;
      city: string | null;
      country: string | null;
    }>();

  if (
    preview.action === "PROMOTE_PARTNER" ||
    preview.action === "PROMOTE_CHILD"
  ) {
    const replacementId = preview.replacementMemberId;
    if (!replacementId)
      return { ok: false, preview, message: "Replacement member is missing." };

    statements.push(
      db
        .prepare(
          "UPDATE member_households SET valid_until = ?, ended_by = ? WHERE household_id = ? AND member_id = ? AND role = 'head' AND valid_until IS NULL",
        )
        .bind(timestamp, actor, householdId, preview.currentHeadId),
      db
        .prepare(
          "UPDATE member_households SET role = 'head' WHERE household_id = ? AND member_id = ? AND valid_until IS NULL",
        )
        .bind(householdId, replacementId),
    );
    statements.push(
      db
        .prepare(
          "UPDATE households SET head_member_id = ?, status = 'active', status_note = ?, updated_at = ? WHERE id = ?",
        )
        .bind(
          replacementId,
          `Head replaced on ${timestamp}.`,
          timestamp,
          householdId,
        ),
    );

    // Transfer active group memberships from the old head to the replacement if they are not already assigned.
    if (preview.currentHeadId) {
      const { results: oldMemberships } = await db
        .prepare(
          "SELECT group_id FROM member_group_memberships WHERE member_id = ? AND valid_until IS NULL",
        )
        .bind(preview.currentHeadId)
        .all<{ group_id: string }>();
      for (const membership of oldMemberships) {
        const existing = await db
          .prepare(
            "SELECT 1 FROM member_group_memberships WHERE member_id = ? AND group_id = ? AND valid_until IS NULL",
          )
          .bind(replacementId, membership.group_id)
          .first();
        statements.push(
          db
            .prepare(
              "UPDATE member_group_memberships SET valid_until = ?, ended_by = ? WHERE member_id = ? AND group_id = ? AND valid_until IS NULL",
            )
            .bind(timestamp, actor, preview.currentHeadId, membership.group_id),
        );
        if (!existing) {
          statements.push(
            db
              .prepare(
                "INSERT INTO member_group_memberships (member_id, group_id, role, assigned_by, valid_from) VALUES (?, ?, 'member', ?, ?)",
              )
              .bind(replacementId, membership.group_id, actor, timestamp),
          );
        }
      }
    }

    statements.push(
      auditStatement(
        db,
        actor,
        "household.head.replace",
        householdId,
        {
          previousHeadId: preview.currentHeadId,
          replacementMemberId: replacementId,
          adultChildIds: preview.adultChildIds,
        },
        timestamp,
      ),
    );
  }

  if (preview.action === "DEACTIVATE_HOUSEHOLD") {
    statements.push(
      db
        .prepare(
          "UPDATE households SET status = 'inactive', status_note = ?, updated_at = ? WHERE id = ?",
        )
        .bind(
          "No eligible head replacement was found.",
          timestamp,
          householdId,
        ),
    );
    const { results: members } = await db
      .prepare(
        `SELECT m.id, m.status
           FROM member_households mh
           JOIN members m ON m.id = mh.member_id
           WHERE mh.household_id = ? AND mh.valid_until IS NULL`,
      )
      .bind(householdId)
      .all<{ id: string; status: MemberStatus }>();
    for (const member of members) {
      if (member.status !== "deceased") {
        statements.push(
          db
            .prepare(
              "UPDATE members SET status = 'inactive', status_note = ?, updated_at = ? WHERE id = ?",
            )
            .bind(
              "Household was deactivated after the head became deceased.",
              timestamp,
              member.id,
            ),
        );
      }
    }
    statements.push(
      auditStatement(
        db,
        actor,
        "household.deactivate",
        householdId,
        { reason: preview.reason },
        timestamp,
      ),
    );
  }

  await db.batch(statements);
  return {
    ok: true,
    preview,
    message:
      preview.action === "PROMOTE_PARTNER"
        ? "Household head replaced by the active partner."
        : preview.action === "PROMOTE_CHILD"
          ? "Household head replaced by the eligible child."
          : "Household deactivated.",
  };
}

/**
 * Email templates for communications.
 */
/**
 * Email templates for communications.
 */
export const EmailTemplates = {
  welcome: {
    name: "welcome",
    subject: "Welcome to ORBIT",
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #2563eb;">Welcome to ORBIT, {{preferred_name}}!</h1>
        <p>We're delighted to have you as part of our community.</p>
        <p>Your membership is now active. You can access your profile and community resources at any time.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 12px; color: #6b7280;">This message was sent to {{email}}. <a href="{{unsubscribe_url}}">Unsubscribe</a></p>
      </body>
      </html>
    `,
    text: `
Welcome to ORBIT, {{preferred_name}}!

We're delighted to have you as part of our community.

Your membership is now active. You can access your profile and community resources at any time.

---

This message was sent to {{email}}. Unsubscribe: {{unsubscribe_url}}
    `,
  },
  notice: {
    name: "notice",
    subject: "{{title}}",
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #2563eb;">{{title}}</h1>
        <div>{{{content}}}</div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 12px; color: #6b7280;">This message was sent to {{email}}. <a href="{{unsubscribe_url}}">Unsubscribe</a></p>
      </body>
      </html>
    `,
    text: `
{{title}}

{{content}}

---

This message was sent to {{email}}. Unsubscribe: {{unsubscribe_url}}
    `,
  },
  reminder: {
    name: "reminder",
    subject: "Reminder: {{title}}",
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #ea580c;">Reminder: {{title}}</h1>
        <div>{{{content}}}</div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 12px; color: #6b7280;">This message was sent to {{email}}. <a href="{{unsubscribe_url}}">Unsubscribe</a></p>
      </body>
      </html>
    `,
    text: `
Reminder: {{title}}

{{content}}

---

This message was sent to {{email}}. Unsubscribe: {{unsubscribe_url}}
    `,
  },
  announcement: {
    name: "announcement",
    subject: "Announcement: {{title}}",
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #7c3aed;">Announcement: {{title}}</h1>
        <div>{{{content}}}</div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 12px; color: #6b7280;">This message was sent to {{email}}. <a href="{{unsubscribe_url}}">Unsubscribe</a></p>
      </body>
      </html>
    `,
    text: `
Announcement: {{title}}

{{content}}

---

This message was sent to {{email}}. Unsubscribe: {{unsubscribe_url}}
    `,
  },
} as const;

export type EmailTemplateName = keyof typeof EmailTemplates;

/**
 * Email template definitions.
 */
export const emailTemplateDefinitions: Record<
  EmailTemplateName,
  { subject: string; html: string; text: string }
> = {
  welcome: {
    subject: "Welcome to ORBIT",
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #2563eb;">Welcome to ORBIT, {{preferred_name}}!</h1>
        <p>We're delighted to have you as part of our community.</p>
        <p>Your membership is now active. You can access your profile and community resources at any time.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 12px; color: #6b7280;">If you have any questions, please contact us at <a href="mailto:support@orbit.example.com">support@orbit.example.com</a>.</p>
      </body>
      </html>
    `,
    text: `
Welcome to ORBIT, {{preferred_name}}!

We're delighted to have you as part of our community.

Your membership is now active. You can access your profile and community resources at any time.

---

If you have any questions, please contact us at support@orbit.example.com.
    `,
  },
  notice: {
    subject: "{{title}}",
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #2563eb;">{{title}}</h1>
        <div>{{{content}}}</div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 12px; color: #6b7280;">This message was sent to {{email}}. <a href="{{unsubscribe_url}}">Unsubscribe</a></p>
      </body>
      </html>
    `,
    text: `
{{title}}

{{content}}

---

This message was sent to {{email}}. Unsubscribe: {{unsubscribe_url}}
    `,
  },
  reminder: {
    subject: "Reminder: {{title}}",
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #ea580c;">Reminder: {{title}}</h1>
        <div>{{{content}}}</div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 12px; color: #6b7280;">This message was sent to {{email}}. <a href="{{unsubscribe_url}}">Unsubscribe</a></p>
      </body>
      </html>
    `,
    text: `
Reminder: {{title}}

{{content}}

---

This message was sent to {{email}}. Unsubscribe: {{unsubscribe_url}}
    `,
  },
  announcement: {
    subject: "Announcement: {{title}}",
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #7c3aed;">Announcement: {{title}}</h1>
        <div>{{{content}}}</div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 12px; color: #6b7280;">This message was sent to {{email}}. <a href="{{unsubscribe_url}}">Unsubscribe</a></p>
      </body>
      </html>
    `,
    text: `
Announcement: {{title}}

{{content}}

---

This message was sent to {{email}}. Unsubscribe: {{unsubscribe_url}}
    `,
  },
};

/**
 * Get an email template by name.
 */
export function getTemplate(name: EmailTemplateName) {
  return emailTemplateDefinitions[name];
}

/**
 * Render an email template with merge fields.
 */
export function renderTemplate(
  name: EmailTemplateName,
  fields: Record<string, string>,
): { subject: string; html: string; text: string } {
  const template = getTemplate(name);
  if (!template) {
    throw new Error(`Email template "${name}" not found`);
  }

  const replaceFields = (str: string, html = false): string =>
    str.replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (match, rawKey, escapedKey) => {
      const key = rawKey ?? escapedKey;
      const value = fields[key];
      if (value === undefined) return match;
      if (!html || rawKey) return value;
      return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    });

  return {
    subject: replaceFields(template.subject),
    html: replaceFields(template.html, true),
    text: replaceFields(template.text),
  };
}

/**
 * Check if an email is unsubscribed.
 */
export async function isUnsubscribed(
  db: D1Database,
  email: string,
): Promise<boolean> {
  const result = await db
    .prepare("SELECT 1 FROM unsubscribes WHERE email = ? COLLATE NOCASE")
    .bind(email.toLowerCase())
    .first();
  return !!result;
}

/**
 * Add an unsubscribe record.
 */
export async function addUnsubscribe(
  db: D1Database,
  email: string,
  unsubscribedAt?: Date,
): Promise<void> {
  const now = unsubscribedAt?.toISOString() ?? new Date().toISOString();
  await db
    .prepare(
      "INSERT OR IGNORE INTO unsubscribes (email, unsubscribe_at, created_at) VALUES (?, ?, ?)",
    )
    .bind(email.trim().toLowerCase(), now, now)
    .run();
}

export async function getCommunicationRecipients(
  db: D1Database,
  filters: {
    status?: string;
    q?: string;
    groupId?: string;
  } = {},
): Promise<CommunicationRecipientRow[]> {
  const groupId = filters.groupId?.trim();
  const status =
    filters.status === undefined
      ? "active"
      : filters.status === "active" ||
          filters.status === "inactive" ||
          filters.status === "moved"
        ? filters.status
        : "";
  const searchTerm = filters.q?.trim() ? `%${filters.q.trim()}%` : "";
  const params: (string | number)[] = [];
  const candidateFilters: string[] = [];
  if (status) {
    candidateFilters.push("other.status = ?");
    params.push(status);
  }
  if (groupId) {
    candidateFilters.push(`EXISTS (
      SELECT 1 FROM member_group_memberships other_group
      WHERE other_group.member_id = other.id
        AND other_group.group_id = ? AND other_group.valid_until IS NULL
    )`);
    params.push(groupId);
  }
  if (searchTerm) {
    candidateFilters.push(
      "(other.full_name LIKE ? OR other.email LIKE ? OR other.preferred_name LIKE ? OR other.first_name LIKE ? OR other.family_name LIKE ?)",
    );
    params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
  }
  const candidateFilter = candidateFilters.length ? ` AND ${candidateFilters.join(" AND ")}` : "";

  let query = `SELECT m.*,
      (SELECT h.name FROM member_households mh
       JOIN households h ON h.id = mh.household_id
       WHERE mh.member_id = m.id AND mh.valid_until IS NULL
       ORDER BY mh.valid_from DESC LIMIT 1) AS household_name
    FROM members m
    WHERE m.archived_at IS NULL AND m.communication_consent = 1
      AND m.status <> 'deceased'
      AND m.id = (
        SELECT MIN(other.id) FROM members other
        WHERE other.email = m.email COLLATE NOCASE AND other.archived_at IS NULL
          AND other.communication_consent = 1 AND other.status <> 'deceased'
          ${candidateFilter}
      )
      AND m.email IS NOT NULL AND m.email <> ''
      AND NOT EXISTS (
        SELECT 1 FROM members other
        WHERE other.email = m.email COLLATE NOCASE AND other.archived_at IS NULL
          AND (other.communication_consent <> 1 OR other.status = 'deceased')
      )
      AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.email = m.email COLLATE NOCASE)`;

  if (status) {
    query += " AND m.status = ?";
    params.push(status);
  }

  if (groupId) {
    query += ` AND EXISTS (
      SELECT 1 FROM member_group_memberships selected_group
      WHERE selected_group.member_id = m.id
        AND selected_group.group_id = ? AND selected_group.valid_until IS NULL
    )`;
    params.push(groupId);
  }

  if (searchTerm) {
    query += " AND (m.full_name LIKE ? OR m.email LIKE ? OR m.preferred_name LIKE ? OR m.first_name LIKE ? OR m.family_name LIKE ?)";
    params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
  }

  query += " ORDER BY m.full_name";
  const results = await db.prepare(query).bind(...params).all<CommunicationRecipientRow>();
  return results.results;
}

/**
 * Get communication statistics.
 */
export async function getCommunicationStats(db: D1Database): Promise<{
  total: number;
  sent: number;
  failed: number;
  opened: number;
  clicked: number;
}> {
  const [queue, opened, clicked] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN status IN ('failed', 'bounced', 'unsubscribed') THEN 1 ELSE 0 END) AS failed
       FROM send_queue`,
    ).first<{ total: number; sent: number; failed: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM communication_logs WHERE status = 'opened'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM communication_logs WHERE status = 'clicked'").first<{ count: number }>(),
  ]);

  return {
    total: queue?.total ?? 0,
    sent: queue?.sent ?? 0,
    failed: queue?.failed ?? 0,
    opened: opened?.count ?? 0,
    clicked: clicked?.count ?? 0,
  };
}
