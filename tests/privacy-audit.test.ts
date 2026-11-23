import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";

const { getAppEnvMock } = vi.hoisted(() => ({ getAppEnvMock: vi.fn() }));
vi.mock("~/lib/env.server", () => ({ getAppEnv: getAppEnvMock }));

import { adminAccessContext, adminEmailContext } from "../app/lib/admin-context";
import { ALL_ADMIN_CAPABILITIES, ALL_ADMIN_MODULES } from "../app/lib/admin-access";
import type { AdminAccessSnapshot } from "../app/lib/admin-access";
import { createPrivacyRequest, updatePrivacyRequest } from "../app/lib/privacy.server";
import { loader as downloadDocument } from "../app/routes/admin/document-download";
import { action as exportMembers } from "../app/routes/admin/member-export";
import { action as privacyAction } from "../app/routes/admin/privacy";
import { action as approvalsAction } from "../app/routes/admin/approvals";
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

function adminContext(access: AdminAccessSnapshot = {
  role: "ADMIN",
  roles: [],
  modules: ALL_ADMIN_MODULES,
  capabilities: ALL_ADMIN_CAPABILITIES,
  departments: [],
  isLegacy: true,
}) {
  const context = new RouterContextProvider();
  context.set(adminEmailContext, "privacy-admin@example.org");
  context.set(adminAccessContext, access);
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
  it("denies sensitive actions when their separate capability is not assigned", async () => {
    const membershipAccess: AdminAccessSnapshot = {
      role: "ADMIN",
      roles: ["MEMBERSHIP"],
      modules: ["overview", "members", "households", "groups"],
      capabilities: [],
      departments: [],
      isLegacy: false,
    };
    const membersForm = new FormData();
    membersForm.set("intent", "export");
    const membersRequest = new Request("https://orbit.example/admin/members/export", { method: "POST", body: membersForm });
    await expect(exportMembers({
      request: membersRequest,
      url: new URL(membersRequest.url),
      pattern: "/admin/members/export",
      context: adminContext(membershipAccess),
      params: {},
    })).rejects.toMatchObject({ init: { status: 403 } });

    const privacyForm = new FormData();
    privacyForm.set("intent", "export");
    privacyForm.set("requestId", "missing");
    const privacyRequest = new Request("https://orbit.example/admin/privacy", { method: "POST", body: privacyForm });
    await expect(privacyAction({
      request: privacyRequest,
      url: new URL(privacyRequest.url),
      pattern: "/admin/privacy",
      context: adminContext({
        ...membershipAccess,
        roles: ["PRIVACY"],
        modules: ["privacy"],
      }),
      params: {},
    })).rejects.toMatchObject({ init: { status: 403 } });

    const approvalsForm = new FormData();
    approvalsForm.set("intent", "decide");
    approvalsForm.set("decision", "approved");
    approvalsForm.set("requestId", "approval-1");
    const approvalsRequest = new Request("https://orbit.example/admin/approvals", { method: "POST", body: approvalsForm });
    await expect(approvalsAction({
      request: approvalsRequest,
      url: new URL(approvalsRequest.url),
      pattern: "/admin/approvals",
      context: adminContext({
        ...membershipAccess,
        roles: [],
        modules: ["approvals"],
      }),
      params: {},
    })).rejects.toMatchObject({ init: { status: 403 } });
  });

  it.each([
    ["export", "csv"],
    ["export-xlsx", "xlsx"],
  ])("records the actor and format for %s", async (intent, format) => {
    await insertMember();
    const form = new FormData();
    form.set("intent", intent);
    const request = new Request("https://orbit.example/admin/members/export", { method: "POST", body: form });
    const args = {
      request,
      url: new URL(request.url),
      pattern: "/admin/members/export",
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
