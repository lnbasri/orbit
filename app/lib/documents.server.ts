import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  approvalNotificationStatement,
  approvalRequestStatement,
  validateApprover,
} from "./approvals.server";
import { auditStatement } from "./db.server";

export interface DocumentTemplate {
  id: string;
  name: string;
  title_template: string;
  body_template: string;
  is_active: number;
}

export interface DocumentPreview {
  title: string;
  body: string;
}

export interface GeneratedDocumentSummary {
  id: string;
  title: string;
  version: number;
  status: "pending_approval" | "approved" | "rejected";
  created_at: string;
  created_by: string;
  subject_name: string;
  template_name: string;
  assigned_to: string;
  approval_status: string;
}

function render(source: string, fields: Record<string, string>) {
  return source.replace(/\{\{\s*([a-zA-Z][\w]*)\s*\}\}/g, (_match, key: string) => fields[key] ?? "");
}

export async function listDocumentTemplates(db: D1Database, activeOnly = false) {
  const { results } = await db
    .prepare(
      `SELECT id, name, title_template, body_template, is_active FROM document_templates
       ${activeOnly ? "WHERE is_active = 1" : ""}
       ORDER BY name`,
    )
    .all<DocumentTemplate>();
  return results;
}

export async function saveDocumentTemplate(
  db: D1Database,
  actor: string,
  input: { id?: string; name: string; title: string; body: string },
  now = new Date(),
) {
  const name = input.name.trim();
  const title = input.title.trim();
  const body = input.body.trim();
  if (!name || name.length > 120 || !title || title.length > 200 || !body || body.length > 12000) {
    return { ok: false as const, message: "Enter a template name, title, and body within the listed limits." };
  }
  const id = input.id?.trim() || crypto.randomUUID();
  const timestamp = now.toISOString();
  try {
    if (input.id) {
      const result = await db
        .prepare(
          `UPDATE document_templates
           SET name = ?, title_template = ?, body_template = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(name, title, body, timestamp, id)
        .run();
      if ((result.meta.changes ?? 0) !== 1) return { ok: false as const, message: "Document template not found." };
    } else {
      await db
        .prepare(
          `INSERT INTO document_templates
             (id, name, title_template, body_template, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, name, title, body, actor, timestamp, timestamp)
        .run();
    }
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed: document_templates.name")) {
      return { ok: false as const, message: "A document template with that name already exists." };
    }
    throw error;
  }
  await auditStatement(db, actor, "document_template.save", id, { name }, timestamp).run();
  return { ok: true as const, message: "Document template saved." };
}

export async function setDocumentTemplateActive(db: D1Database, actor: string, id: string, active: boolean, now = new Date()) {
  const timestamp = now.toISOString();
  const result = await db
    .prepare("UPDATE document_templates SET is_active = ?, updated_at = ? WHERE id = ?")
    .bind(active ? 1 : 0, timestamp, id)
    .run();
  if ((result.meta.changes ?? 0) !== 1) return { ok: false as const, message: "Document template not found." };
  await auditStatement(db, actor, active ? "document_template.activate" : "document_template.deactivate", id, null, timestamp).run();
  return { ok: true as const, message: active ? "Template activated." : "Template deactivated." };
}

async function memberFields(db: D1Database, memberId: string) {
  const row = await db
    .prepare(
      `SELECT m.full_name, m.preferred_name, m.first_name, m.middle_name, m.family_name,
              m.date_of_birth, m.email, m.phone, m.address, m.postal_code, m.city, m.country,
              m.joined_on, h.id AS household_id, h.name AS household_name,
              (SELECT COUNT(*) FROM member_households mh2
               WHERE mh2.household_id = h.id AND mh2.valid_until IS NULL) AS total_members
       FROM members m
       LEFT JOIN member_households mh ON mh.member_id = m.id AND mh.valid_until IS NULL
       LEFT JOIN households h ON h.id = mh.household_id
       WHERE m.id = ? AND m.archived_at IS NULL`,
    )
    .bind(memberId)
    .first<Record<string, string | number | null>>();
  if (!row) throw new Error("Member not found or archived.");
  return {
    memberId,
    householdId: row.household_id ? String(row.household_id) : null,
    fields: Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value == null ? "" : String(value)]),
    ),
  };
}

async function householdFields(db: D1Database, householdId: string) {
  const row = await db
    .prepare(
      `SELECT h.name AS household_name, h.address, h.postal_code, h.city, h.country,
              (SELECT COUNT(*) FROM member_households mh
               WHERE mh.household_id = h.id AND mh.valid_until IS NULL) AS total_members
       FROM households h WHERE h.id = ? AND h.status = 'active'`,
    )
    .bind(householdId)
    .first<Record<string, string | number | null>>();
  if (!row) throw new Error("Active household not found.");
  return {
    memberId: null,
    householdId,
    fields: Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value == null ? "" : String(value)]),
    ),
  };
}

export async function previewDocument(
  db: D1Database,
  templateId: string,
  target: { memberId?: string; householdId?: string },
  customFields: Record<string, string> = {},
  now = new Date(),
): Promise<DocumentPreview> {
  const template = await db
    .prepare("SELECT title_template, body_template FROM document_templates WHERE id = ? AND is_active = 1")
    .bind(templateId)
    .first<{ title_template: string; body_template: string }>();
  if (!template) throw new Error("Active document template not found.");
  if (Boolean(target.memberId) === Boolean(target.householdId)) {
    throw new Error("Select exactly one member or household.");
  }
  const record = target.memberId
    ? await memberFields(db, target.memberId)
    : await householdFields(db, target.householdId!);
  const fields = {
    ...customFields,
    ...record.fields,
    generated_at: now.toISOString().slice(0, 10),
  };
  return { title: render(template.title_template, fields), body: render(template.body_template, fields) };
}

function wrapLine(text: string, font: { widthOfTextAtSize(text: string, size: number): number }, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const pieces: string[] = [];
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      pieces.push(word);
    } else {
      let piece = "";
      for (const character of Array.from(word)) {
        if (piece && font.widthOfTextAtSize(piece + character, size) > maxWidth) {
          pieces.push(piece);
          piece = character;
        } else {
          piece += character;
        }
      }
      if (piece) pieces.push(piece);
    }
    for (const piece of pieces) {
      const candidate = line ? `${line} ${piece}` : piece;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = piece;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function createPdf(title: string, body: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 52;
  const bodySize = 11;
  const lineHeight = 16;
  let page = pdf.addPage(pageSize);
  let y = page.getHeight() - margin;
  const ensureSpace = () => {
    if (y < margin + lineHeight) {
      page = pdf.addPage(pageSize);
      y = page.getHeight() - margin;
    }
  };
  try {
    for (const line of wrapLine(title, bold, 18, page.getWidth() - margin * 2)) {
      page.drawText(line, { x: margin, y, size: 18, font: bold });
      y -= 26;
    }
    y -= 10;
    for (const paragraph of body.split(/\r?\n/)) {
      if (!paragraph.trim()) {
        y -= lineHeight;
        ensureSpace();
        continue;
      }
      for (const line of wrapLine(paragraph, font, bodySize, page.getWidth() - margin * 2)) {
        ensureSpace();
        page.drawText(line, { x: margin, y, size: bodySize, font });
        y -= lineHeight;
      }
    }
  } catch (error) {
    throw new Error(`The document contains characters unsupported by the built-in PDF font: ${String(error)}`);
  }
  return pdf.save();
}

export async function generateDocument(
  db: D1Database,
  bucket: R2Bucket,
  input: {
    templateId: string;
    memberId?: string;
    householdId?: string;
    customFields?: Record<string, string>;
    requestedBy: string;
    assignedTo: string;
  },
  now = new Date(),
) {
  const memberId = input.memberId?.trim() || null;
  const householdId = input.householdId?.trim() || null;
  if (Boolean(memberId) === Boolean(householdId)) {
    return { ok: false as const, message: "Select exactly one member or household." };
  }
  const approvalError = await validateApprover(db, input.requestedBy, input.assignedTo);
  if (approvalError) return { ok: false as const, message: approvalError };
  const customFields = input.customFields ?? {};
  if (Object.entries(customFields).some(([key, value]) =>
    !/^[a-zA-Z][\w]{0,39}$/.test(key) || value.length > 1000,
  )) {
    return { ok: false as const, message: "Document merge fields exceed the allowed size." };
  }
  const template = await db
    .prepare("SELECT * FROM document_templates WHERE id = ? AND is_active = 1")
    .bind(input.templateId)
    .first<DocumentTemplate>();
  if (!template) return { ok: false as const, message: "Select an active document template." };

  const record = memberId
    ? await memberFields(db, memberId)
    : await householdFields(db, householdId!);
  const fields = {
    ...(input.customFields ?? {}),
    ...record.fields,
    generated_at: now.toISOString().slice(0, 10),
  };
  const title = render(template.title_template, fields);
  const body = render(template.body_template, fields);
  if (!title.trim() || !body.trim()) return { ok: false as const, message: "The rendered document is empty." };
  if (title.length > 200 || body.length > 20_000) {
    return { ok: false as const, message: "The rendered document exceeds the allowed size." };
  }

  const latest = await db
    .prepare(
      `SELECT series_id, version FROM generated_documents
       WHERE template_id = ? AND member_id IS ? AND household_id IS ?
       ORDER BY version DESC LIMIT 1`,
    )
    .bind(template.id, memberId, householdId)
    .first<{ series_id: string; version: number }>();
  const id = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const seriesId = latest?.series_id ?? crypto.randomUUID();
  const version = (latest?.version ?? 0) + 1;
  const storageKey = `documents/${id}/v${version}.pdf`;
  const timestamp = now.toISOString();
  const bytes = await createPdf(title, body);
  await bucket.put(storageKey, bytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { documentId: id, version: String(version) },
  });

  try {
    await db.batch([
      approvalRequestStatement(db, {
        id: approvalId,
        resourceType: "document",
        resourceId: id,
        requestedBy: input.requestedBy,
        assignedTo: input.assignedTo,
        now: timestamp,
      }),
      db.prepare(
        `INSERT INTO generated_documents
           (id, series_id, version, template_id, member_id, household_id, title, rendered_text,
            storage_key, approval_request_id, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?)`,
      ).bind(
        id,
        seriesId,
        version,
        template.id,
        memberId,
        householdId,
        title,
        body,
        storageKey,
        approvalId,
        input.requestedBy.toLowerCase(),
        timestamp,
      ),
      approvalNotificationStatement(
        db,
        approvalId,
        input.assignedTo,
        `Document awaiting approval: ${title}`,
        "/admin/approvals",
        timestamp,
      ),
      auditStatement(db, input.requestedBy, "document.generate", id, {
        templateId: template.id,
        version,
        approver: input.assignedTo.toLowerCase(),
      }, timestamp),
    ]);
  } catch (error) {
    await bucket.delete(storageKey);
    throw error;
  }
  return { ok: true as const, id, approvalId, version, message: "PDF generated and submitted for approval." };
}

export async function listGeneratedDocuments(db: D1Database) {
  const { results } = await db.prepare(
    `SELECT d.id, d.title, d.version, d.status, d.created_at, d.created_by,
            COALESCE(m.full_name, h.name) AS subject_name, t.name AS template_name,
            a.assigned_to, a.status AS approval_status
     FROM generated_documents d
     JOIN document_templates t ON t.id = d.template_id
     JOIN approval_requests a ON a.id = d.approval_request_id
     LEFT JOIN members m ON m.id = d.member_id
     LEFT JOIN households h ON h.id = d.household_id
     ORDER BY d.created_at DESC LIMIT 100`,
  ).all<GeneratedDocumentSummary>();
  return results;
}

export async function getApprovedDocument(db: D1Database, bucket: R2Bucket, id: string) {
  const row = await db.prepare(
    `SELECT title, storage_key FROM generated_documents WHERE id = ? AND status = 'approved'`,
  ).bind(id).first<{ title: string; storage_key: string }>();
  if (!row) return null;
  const object = await bucket.get(row.storage_key);
  if (!object) throw new Error(`Stored PDF for document ${id} is missing.`);
  return { title: row.title, body: object.body };
}
