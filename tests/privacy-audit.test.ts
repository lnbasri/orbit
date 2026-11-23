import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";

const { getAppEnvMock } = vi.hoisted(() => ({ getAppEnvMock: vi.fn() }));
vi.mock("~/lib/env.server", () => ({ getAppEnv: getAppEnvMock }));

import { adminEmailContext } from "../app/lib/admin-context";
import { createPrivacyRequest, updatePrivacyRequest } from "../app/lib/privacy.server";
import { loader as downloadDocument } from "../app/routes/admin/document-download";
import { action as exportMembers } from "../app/routes/admin/members";
import { action as privacyAction } from "../app/routes/admin/privacy";
import { resetDb, startDb } from "./helpers";

let db: D1Database;
let documents: R2Bucket;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, documents, dispose } = await startDb());
  getAppEnvMock.mockReturnValue({ DB: db, DOCUMENTS: documents });
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  await resetDb(db);
});

function adminContext() {
  const context = new RouterContextProvider();
  context.set(adminEmailContext, "privacy-admin@example.org");
  return context;
}

async function insertMember() {
  const timestamp = "2026-11-23T10:00:00.000Z";
  await db.prepare(
    `INSERT INTO members (id, full_name, gender, status, created_at, updated_at)
     VALUES ('member-1', 'Privacy Test Member', 'female', 'active', ?, ?)`,
  ).bind(timestamp, timestamp).run();
}

describe("personal data access audit", () => {
  it.each([
    ["export", "csv"],
    ["export-xlsx", "xlsx"],
  ])("records the actor and format for %s", async (intent, format) => {
    await insertMember();
    const form = new FormData();
    form.set("intent", intent);
    const request = new Request("https://orbit.example/admin/members", { method: "POST", body: form });
    const args = {
      request,
      url: new URL(request.url),
      pattern: "/admin/members",
      context: adminContext(),
      params: {},
    } satisfies Parameters<typeof exportMembers>[0];

    await exportMembers(args);

    const audit = await db.prepare(
      "SELECT actor, action, target, detail FROM audit_log WHERE action = 'member.export'",
    ).first<{ actor: string; action: string; target: string | null; detail: string }>();
    expect(audit).toEqual({
      actor: "privacy-admin@example.org",
      action: "member.export",
      target: null,
      detail: JSON.stringify({ format, count: 1 }),
    });
  });

  it("records successful document downloads but not missing documents", async () => {
    await insertMember();
    const timestamp = "2026-11-23T10:00:00.000Z";
    await db.batch([
      db.prepare(
        `INSERT INTO approval_requests
         (id, resource_type, resource_id, requested_by, assigned_to, status, decision_by, decision_at, created_at, updated_at)
         VALUES ('approval-1', 'document', 'document-1', 'sender@example.org', 'reviewer@example.org',
                 'approved', 'reviewer@example.org', ?, ?, ?)`,
      ).bind(timestamp, timestamp, timestamp),
      db.prepare(
        `INSERT INTO generated_documents
         (id, series_id, version, template_id, member_id, title, rendered_text, storage_key,
          approval_request_id, status, created_by, created_at, approved_by, approved_at)
         VALUES ('document-1', 'series-1', 1, 'membership-certificate', 'member-1',
                 'Member certificate', 'Certificate body', 'documents/document-1.pdf',
                 'approval-1', 'approved', 'sender@example.org', ?, 'reviewer@example.org', ?)`,
      ).bind(timestamp, timestamp),
    ]);
    await documents.put("documents/document-1.pdf", "%PDF-test");

    const request = new Request("https://orbit.example/admin/documents/document-1/download");
    const args = {
      request,
      url: new URL(request.url),
      pattern: "/admin/documents/:id/download",
      context: adminContext(),
      params: { id: "document-1" },
    } satisfies Parameters<typeof downloadDocument>[0];
    const response = await downloadDocument(args);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");

    const audit = await db.prepare(
      "SELECT actor, action, target FROM audit_log WHERE action = 'document.download'",
    ).first<{ actor: string; action: string; target: string }>();
    expect(audit).toEqual({
      actor: "privacy-admin@example.org",
      action: "document.download",
      target: "document-1",
    });

    await downloadDocument({
      ...args,
      params: { id: "missing-document" },
    });
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'document.download'",
    ).first()).toEqual({ count: 1 });
  });

  it("audits a prepared privacy export", async () => {
    await insertMember();
    const requestCase = await createPrivacyRequest(
      db,
      "privacy-admin@example.org",
      "member-1",
      { requestType: "access", receivedOn: "2026-11-23", dueOn: "", internalNotes: "" },
    );
    expect(requestCase.ok).toBe(true);
    if (!requestCase.ok) return;
    await updatePrivacyRequest(db, "privacy-admin@example.org", requestCase.id, {
      status: "in_progress",
      verificationStatus: "verified",
      dueOn: "",
      internalNotes: "",
    });

    const form = new FormData();
    form.set("intent", "export");
    form.set("requestId", requestCase.id);
    const request = new Request("https://orbit.example/admin/privacy", { method: "POST", body: form });
    const response = await privacyAction({
      request,
      url: new URL(request.url),
      pattern: "/admin/privacy",
      context: adminContext(),
      params: {},
    });
    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) return;
    expect(response.headers.get("Content-Type")).toBe("application/zip");

    const audit = await db.prepare(
      "SELECT actor, action, target, detail FROM audit_log WHERE action = 'privacy.request.export'",
    ).first<{ actor: string; action: string; target: string; detail: string }>();
    expect(audit).toEqual({
      actor: "privacy-admin@example.org",
      action: "privacy.request.export",
      target: requestCase.id,
      detail: '{"format":"zip"}',
    });
  });
});
