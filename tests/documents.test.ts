import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { decideApproval } from "../app/lib/approvals.server";
import {
  generateDocument,
  getApprovedDocument,
  saveDocumentTemplate,
} from "../app/lib/documents.server";
import { resetDb, startDb } from "./helpers";

let db: D1Database;
let documents: R2Bucket;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, documents, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => resetDb(db));

async function seedData() {
  const timestamp = new Date("2026-11-23T10:00:00.000Z").toISOString();
  await db.batch([
    db.prepare("INSERT INTO admins (email, role, active, added_by, added_at) VALUES (?, 'SUPER_ADMIN', 1, 'test', ?)")
      .bind("sender@example.org", timestamp),
    db.prepare("INSERT INTO admins (email, role, active, added_by, added_at) VALUES (?, 'ADMIN', 1, 'test', ?)")
      .bind("reviewer@example.org", timestamp),
    db.prepare(
      `INSERT INTO members
        (id, full_name, first_name, family_name, gender, email, status, created_at, updated_at)
       VALUES ('member-1', 'Ada Lovelace', 'Ada', 'Lovelace', 'female', 'ada@example.org', 'active', ?, ?)`,
    ).bind(timestamp, timestamp),
  ]);
  const template = await saveDocumentTemplate(db, "sender@example.org", {
    name: "Test certificate",
    title: "Certificate for {{full_name}}",
    body: "Member since {{joined_on}}.",
  }, new Date(timestamp));
  expect(template.ok).toBe(true);
  const row = await db.prepare("SELECT id FROM document_templates WHERE name = ?")
    .bind("Test certificate").first<{ id: string }>();
  return row!.id;
}

describe("document automation", () => {
  it("stores versioned PDFs and keeps them unavailable until approval", async () => {
    const templateId = await seedData();
    const input = {
      templateId,
      memberId: "member-1",
      requestedBy: "sender@example.org",
      assignedTo: "reviewer@example.org",
    };
    const first = await generateDocument(db, documents, input, new Date("2026-11-23T10:01:00.000Z"));
    expect(first).toMatchObject({ ok: true, version: 1 });
    if (!first.ok) return;

    const pending = await getApprovedDocument(db, documents, first.id);
    expect(pending).toBeNull();
    const object = await documents.get(`documents/${first.id}/v1.pdf`);
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe("application/pdf");
    const bytes = new Uint8Array(await object!.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    expect(await decideApproval(db, first.approvalId, "reviewer@example.org", "approved"))
      .toMatchObject({ ok: true });
    expect(await getApprovedDocument(db, documents, first.id)).not.toBeNull();

    const second = await generateDocument(db, documents, input, new Date("2026-11-23T10:02:00.000Z"));
    expect(second).toMatchObject({ ok: true, version: 2 });
  });

  it("rejects self-approval assignment and refuses an inactive approver", async () => {
    const templateId = await seedData();
    const self = await generateDocument(db, documents, {
      templateId,
      memberId: "member-1",
      requestedBy: "sender@example.org",
      assignedTo: "sender@example.org",
    });
    expect(self).toMatchObject({ ok: false, message: "Choose a different administrator to review this item." });

    await db.prepare("UPDATE admins SET active = 0 WHERE email = ?").bind("reviewer@example.org").run();
    const inactive = await generateDocument(db, documents, {
      templateId,
      memberId: "member-1",
      requestedBy: "sender@example.org",
      assignedTo: "reviewer@example.org",
    });
    expect(inactive).toMatchObject({ ok: false, message: "The selected approver is not an active administrator." });
  });
});
