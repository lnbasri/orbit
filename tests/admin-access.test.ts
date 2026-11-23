import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { addAdmin, ensureBootstrap } from "../app/lib/admins.server";
import {
  createAdminDepartment,
  getAdminAccess,
  setAdminAccess,
} from "../app/lib/admin-access.server";
import {
  getAdminRouteAccess,
  hasAdminCapability,
  hasAdminModule,
  hasAdminRouteAccess,
} from "../app/lib/admin-access";
import { resetDb, startDb, T0 } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => resetDb(db));

describe("administrator permission bundles", () => {
  it("limits an assigned administrator to the union of explicitly assigned roles", async () => {
    await ensureBootstrap(db, "owner@example.org");
    await addAdmin(db, "owner@example.org", "finance@example.org", "Finance", "ADMIN", T0, ["FINANCE"]);

    const access = await getAdminAccess(db, "finance@example.org", "ADMIN");
    expect(hasAdminModule(access, "contributions")).toBe(true);
    expect(hasAdminModule(access, "members")).toBe(false);
    expect(access.isLegacy).toBe(false);

    const result = await setAdminAccess(
      db,
      "owner@example.org",
      "finance@example.org",
      ["FINANCE", "COMMUNICATIONS"],
      [],
      [],
      T0,
    );
    expect(result.ok).toBe(true);
    const combined = await getAdminAccess(db, "finance@example.org", "ADMIN");
    expect(hasAdminModule(combined, "contributions")).toBe(true);
    expect(hasAdminModule(combined, "communications")).toBe(true);
    expect(hasAdminModule(combined, "members")).toBe(false);
  });

  it("preserves broad access for unassigned existing admins, but identifies the legacy state", async () => {
    await ensureBootstrap(db, "owner@example.org");
    await db.prepare(
      "INSERT INTO admins (email, role, active, added_by, added_at) VALUES (?, 'ADMIN', 1, 'test', ?)",
    ).bind("legacy@example.org", T0.toISOString()).run();

    const access = await getAdminAccess(db, "legacy@example.org", "ADMIN");
    expect(access.isLegacy).toBe(true);
    expect(hasAdminModule(access, "privacy")).toBe(true);
    expect(hasAdminCapability(access, "privacy.export")).toBe(true);
  });

  it("requires a non-empty permission bundle before an administrator can leave legacy access", async () => {
    await ensureBootstrap(db, "owner@example.org");
    await addAdmin(db, "owner@example.org", "member@example.org", "Member", "ADMIN", T0);

    expect(await setAdminAccess(db, "owner@example.org", "member@example.org", [], [], [], T0))
      .toMatchObject({ ok: false, message: expect.stringContaining("empty role list") });
    expect(hasAdminModule(await getAdminAccess(db, "member@example.org", "ADMIN"), "contributions")).toBe(false);
  });

  it("keeps department labels separate from permissions and audits access changes", async () => {
    await ensureBootstrap(db, "owner@example.org");
    await addAdmin(db, "owner@example.org", "member@example.org", "Member", "ADMIN", T0, ["MEMBERSHIP"]);
    const department = await createAdminDepartment(db, "owner@example.org", "Membership Commission", T0);
    expect(department.ok).toBe(true);
    const row = await db.prepare("SELECT id FROM admin_departments WHERE name = ?")
      .bind("Membership Commission").first<{ id: string }>();

    const result = await setAdminAccess(
      db,
      "owner@example.org",
      "member@example.org",
      ["MEMBERSHIP"],
      ["members.export"],
      [row!.id],
      T0,
    );
    expect(result.ok).toBe(true);
    const access = await getAdminAccess(db, "member@example.org", "ADMIN");
    expect(access.departments).toEqual(["Membership Commission"]);
    expect(hasAdminModule(access, "members")).toBe(true);
    expect(hasAdminCapability(access, "members.export")).toBe(true);
    const audit = await db.prepare(
      "SELECT detail FROM audit_log WHERE action = 'admin.access.change' AND target = ?",
    ).bind("member@example.org").first<{ detail: string }>();
    expect(JSON.parse(audit!.detail)).toMatchObject({
      roles: ["MEMBERSHIP"],
      capabilities: ["members.export"],
      departments: [row!.id],
    });
  });

  it("maps sensitive downloads and administrator management to distinct route permissions", () => {
    expect(getAdminRouteAccess("/admin/documents/abc-123/download")).toEqual({
      kind: "capability",
      key: "documents.download",
    });
    expect(getAdminRouteAccess("/admin/admins")).toEqual({ kind: "super-admin" });
    expect(getAdminRouteAccess("/admin/unknown")).toBeNull();
  });

  it("fails closed for modules, exports, downloads, and administrator management outside assigned roles", async () => {
    await ensureBootstrap(db, "owner@example.org");
    await addAdmin(db, "owner@example.org", "finance@example.org", "Finance", "ADMIN", T0, ["FINANCE"]);
    const access = await getAdminAccess(db, "finance@example.org", "ADMIN");

    expect(hasAdminRouteAccess(access, getAdminRouteAccess("/admin/contributions")!)).toBe(true);
    expect(hasAdminRouteAccess(access, getAdminRouteAccess("/admin/members")!)).toBe(false);
    expect(hasAdminRouteAccess(access, getAdminRouteAccess("/admin/documents")!)).toBe(false);
    expect(hasAdminRouteAccess(access, getAdminRouteAccess("/admin/documents/document-1/download")!)).toBe(false);
    expect(hasAdminRouteAccess(access, getAdminRouteAccess("/admin/admins")!)).toBe(false);
  });
});
