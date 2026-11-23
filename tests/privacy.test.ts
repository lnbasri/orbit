import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";

import {
  buildPrivacyExport,
  createPrivacyRequest,
  updatePrivacyRequest,
} from "../app/lib/privacy.server";
import { resetDb, startDb } from "./helpers";

let db: D1Database;
let documents: R2Bucket;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, documents, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  await resetDb(db);
});

async function seedMemberData() {
  const timestamp = "2026-11-23T10:00:00.000Z";
  await db.batch([
    db.prepare(
      `INSERT INTO members
       (id, full_name, first_name, family_name, gender, email, status, created_at, updated_at)
       VALUES ('member-1', 'Privacy Subject', 'Privacy', 'Subject', 'female',
               'current@example.org', 'active', ?, ?)`,
    ).bind(timestamp, timestamp),
    db.prepare(
      `INSERT INTO members
       (id, full_name, gender, email, status, created_at, updated_at)
       VALUES ('member-2', 'Third Party', 'male', 'other@example.org', 'active', ?, ?)`,
    ).bind(timestamp, timestamp),
    db.prepare(
      `INSERT INTO member_history (member_id, changed_at, changed_by, changes_json)
       VALUES ('member-1', ?, 'admin@example.org',
               '{"email":{"from":"old@example.org","to":"current@example.org"}}')`,
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO households (id, name, address, city, country, status, created_at, updated_at)
       VALUES ('household-1', 'Subject Household', 'Main Street 1', 'The Hague', 'NL', 'active', ?, ?)`,
    ).bind(timestamp, timestamp),
  ]);
  await db.batch([
    db.prepare(
      `INSERT INTO member_households
       (member_id, household_id, role, assigned_by, valid_from)
       VALUES ('member-1', 'household-1', 'head', 'admin@example.org', ?)`,
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO member_households
       (member_id, household_id, role, assigned_by, valid_from)
       VALUES ('member-2', 'household-1', 'partner', 'admin@example.org', ?)`,
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO member_relationships
       (id, member_id, related_member_id, relationship, created_by, valid_from)
       VALUES ('relationship-1', 'member-1', 'member-2', 'sibling', 'admin@example.org', ?)`,
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO contributions
       (id, household_id, record_type, title, amount_minor, currency_code, minor_unit_exponent,
        created_by, created_at, updated_at)
       VALUES ('contribution-1', 'household-1', 'contribution', 'Annual dues', 10000,
               'EUR', 2, 'admin@example.org', ?, ?)`,
    ).bind(timestamp, timestamp),
    db.prepare(
      `INSERT INTO approval_requests
       (id, resource_type, resource_id, requested_by, assigned_to, status, decision_by,
        decision_at, created_at, updated_at)
       VALUES ('approval-1', 'document', 'document-1', 'admin@example.org', 'reviewer@example.org',
               'approved', 'reviewer@example.org', ?, ?, ?)`,
    ).bind(timestamp, timestamp, timestamp),
    db.prepare(
      `INSERT INTO generated_documents
       (id, series_id, version, template_id, member_id, title, rendered_text, storage_key,
        approval_request_id, status, created_by, created_at, approved_by, approved_at)
       VALUES ('document-1', 'series-1', 1, 'membership-certificate', 'member-1',
               'Membership certificate', 'Certificate for Privacy Subject',
               'documents/member-1.pdf', 'approval-1', 'approved',
               'admin@example.org', ?, 'reviewer@example.org', ?)`,
    ).bind(timestamp, timestamp),
  ]);
  await db.prepare(
    `INSERT INTO contribution_payments
     (id, contribution_id, amount_minor, paid_on, method, recorded_by, created_at)
     VALUES ('payment-1', 'contribution-1', 5000, '2026-11-01', 'bank_transfer', 'admin@example.org', ?)`,
  ).bind(timestamp).run();
  await documents.put("documents/member-1.pdf", "%PDF-export-test");
}

describe("privacy request records and exports", () => {
  it("validates request details, records changes, and requires verification before export", async () => {
    await seedMemberData();
    const invalid = await createPrivacyRequest(
      db,
      "admin@example.org",
      "member-1",
      { requestType: "unknown", receivedOn: "2026-11-23", dueOn: "", internalNotes: "" },
    );
    expect(invalid).toMatchObject({ ok: false });

    const created = await createPrivacyRequest(
      db,
      "admin@example.org",
      "member-1",
      { requestType: "access", receivedOn: "2026-11-23", dueOn: "", internalNotes: "Verify by phone." },
      new Date("2026-11-23T11:00:00.000Z"),
    );
    expect(created).toMatchObject({ ok: true, message: "Privacy request recorded." });
    if (!created.ok) return;

    await expect(buildPrivacyExport(db, documents, created.id))
      .rejects.toThrow("Verify the requester's identity");

    const updated = await updatePrivacyRequest(
      db,
      "admin@example.org",
      created.id,
      {
        status: "in_progress",
        verificationStatus: "verified",
        dueOn: "2026-12-01",
        internalNotes: "Identity verified.",
      },
      new Date("2026-11-23T12:00:00.000Z"),
    );
    expect(updated).toMatchObject({ ok: true, message: "Privacy request updated." });

    const auditRows = await db.prepare(
      `SELECT action, target, detail FROM audit_log
       WHERE action LIKE 'privacy.request.%' ORDER BY id`,
    ).all<{ action: string; target: string; detail: string }>();
    expect(auditRows.results.map(({ action }) => action)).toEqual([
      "privacy.request.create",
      "privacy.request.update",
    ]);
    expect(auditRows.results[0].detail).toBe(
      '{"requestType":"access","receivedOn":"2026-11-23","dueOn":null}',
    );
    expect(auditRows.results[1].detail).toBe(
      '{"status":"in_progress","verificationStatus":"verified","dueOn":"2026-12-01","notesChanged":true}',
    );

    const declined = await createPrivacyRequest(
      db,
      "admin@example.org",
      "member-1",
      { requestType: "access", receivedOn: "2026-11-23", dueOn: "", internalNotes: "" },
    );
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    await updatePrivacyRequest(db, "admin@example.org", declined.id, {
      status: "declined",
      verificationStatus: "verified",
      dueOn: "",
      internalNotes: "",
    });
    await expect(buildPrivacyExport(db, documents, declined.id))
      .rejects.toThrow("declined request");
  });

  it("builds a reviewable package with linked records while omitting other members' identities", async () => {
    await seedMemberData();
    const created = await createPrivacyRequest(
      db,
      "admin@example.org",
      "member-1",
      { requestType: "access", receivedOn: "2026-11-23", dueOn: "", internalNotes: "" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await updatePrivacyRequest(db, "admin@example.org", created.id, {
      status: "in_progress",
      verificationStatus: "verified",
      dueOn: "",
      internalNotes: "Internal note not for export.",
    });
    const archive = await buildPrivacyExport(db, documents, created.id, new Date("2026-11-23T13:00:00.000Z"));
    const files = unzipSync(archive);
    expect(Object.keys(files)).toContain("data.json");
    expect(Object.keys(files)).toContain("documents/Membership-certificate-document-1.pdf");
    expect(strFromU8(files["documents/Membership-certificate-document-1.pdf"])).toBe("%PDF-export-test");

    const data = JSON.parse(strFromU8(files["data.json"])) as {
      subject: { full_name: string };
      request: { request_type: string };
      householdMemberships: unknown[];
      relationships: unknown[];
      contributions: { sharedHousehold: unknown[]; payments: unknown[] };
      documents: unknown[];
      reviewWarnings: string[];
      communication: { emailAddresses: string[] };
    };
    expect(data.subject.full_name).toBe("Privacy Subject");
    expect(data.request.request_type).toBe("access");
    expect(data.householdMemberships).toHaveLength(1);
    expect(data.relationships).toHaveLength(1);
    expect(data.contributions.sharedHousehold).toHaveLength(1);
    expect(data.contributions.payments).toHaveLength(1);
    expect(data.documents).toHaveLength(1);
    expect(data.communication.emailAddresses).toEqual(["current@example.org", "old@example.org"]);
    expect(data.reviewWarnings.length).toBeGreaterThan(0);
    expect(strFromU8(files["data.json"])).not.toContain("Third Party");
    expect(strFromU8(files["data.json"])).not.toContain("Internal note not for export.");
  });

  it("does not silently omit a generated document missing from storage", async () => {
    await seedMemberData();
    await documents.delete("documents/member-1.pdf");
    const created = await createPrivacyRequest(
      db,
      "admin@example.org",
      "member-1",
      { requestType: "portability", receivedOn: "2026-11-23", dueOn: "", internalNotes: "" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await updatePrivacyRequest(db, "admin@example.org", created.id, {
      status: "in_progress",
      verificationStatus: "verified",
      dueOn: "",
      internalNotes: "",
    });

    await expect(buildPrivacyExport(db, documents, created.id))
      .rejects.toThrow("is missing from document storage");
  });
});
