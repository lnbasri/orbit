import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addAdmin,
  ensureBootstrap,
  getAdmin,
  isAdmin,
  listAdmins,
  parseEmailList,
  removeAdmin,
  setAdminRole,
  touchLogin,
} from "../app/lib/admins.server";
import { resetDb, startDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  await resetDb(db);
});

const emails = async () => (await listAdmins(db)).map((a) => a.email);

describe("bootstrap from ADMIN_EMAILS", () => {
  it("parses, lower-cases and de-duplicates the seed list, ignoring junk", () => {
    expect(parseEmailList("A@x.nl, b@x.nl;a@X.nl  not-an-email")).toEqual(["a@x.nl", "b@x.nl"]);
  });

  it("seeds an empty table once and never again", async () => {
    expect(await ensureBootstrap(db, "a@x.nl,b@x.nl")).toBe(true);
    expect(await emails()).toEqual(["a@x.nl", "b@x.nl"]);

    // Someone is removed later: the seed var must not bring them back.
    expect((await removeAdmin(db, "a@x.nl", "b@x.nl")).ok).toBe(true);
    expect(await ensureBootstrap(db, "a@x.nl,b@x.nl")).toBe(false);
    expect(await emails()).toEqual(["a@x.nl"]);
  });

  it("does nothing without a usable seed", async () => {
    expect(await ensureBootstrap(db, "")).toBe(false);
    expect(await ensureBootstrap(db, undefined)).toBe(false);
    expect(await emails()).toEqual([]);
  });
});

describe("authorization lookup", () => {
  it("is case-insensitive and false for strangers", async () => {
    await ensureBootstrap(db, "Admin@orbit.example");
    expect(await isAdmin(db, "admin@orbit.example")).toBe(true);
    expect(await isAdmin(db, " ADMIN@ORBIT.EXAMPLE ")).toBe(true);
    expect(await isAdmin(db, "other@orbit.example")).toBe(false);
  });
});

describe("add admin", () => {
  it("adds a normalised admin with who and when, and writes an audit entry", async () => {
    await ensureBootstrap(db, "a@x.nl");
    const res = await addAdmin(db, "a@x.nl", "  New@X.nl ", " Siti ");
    expect(res.ok).toBe(true);
    const row = (await listAdmins(db)).find((a) => a.email === "new@x.nl");
    expect(row).toMatchObject({ name: "Siti", added_by: "a@x.nl" });
    const audit = await db.prepare("SELECT action, target, actor FROM audit_log WHERE action = 'admin.add'").first();
    expect(audit).toMatchObject({ target: "new@x.nl", actor: "a@x.nl" });
  });

  it("rejects invalid and duplicate emails", async () => {
    await ensureBootstrap(db, "a@x.nl");
    expect((await addAdmin(db, "a@x.nl", "not-an-email")).ok).toBe(false);
    expect(await addAdmin(db, "a@x.nl", "A@X.nl")).toMatchObject({ ok: false, message: expect.stringContaining("already") });
    expect(await emails()).toEqual(["a@x.nl"]);
  });
});

describe("remove admin", () => {
  it("removes another admin and audits it", async () => {
    await ensureBootstrap(db, "a@x.nl,b@x.nl");
    expect((await removeAdmin(db, "a@x.nl", "B@x.nl")).ok).toBe(true);
    expect(await isAdmin(db, "b@x.nl")).toBe(false);
    const audit = await db.prepare("SELECT target FROM audit_log WHERE action = 'admin.remove'").first();
    expect(audit).toMatchObject({ target: "b@x.nl" });
  });

  it("refuses to remove yourself", async () => {
    await ensureBootstrap(db, "a@x.nl,b@x.nl");
    expect(await removeAdmin(db, "a@x.nl", "A@x.nl")).toMatchObject({ ok: false });
    expect(await emails()).toEqual(["a@x.nl", "b@x.nl"]);
  });

  it("never removes the last admin, even if someone else asks", async () => {
    await ensureBootstrap(db, "a@x.nl");
    expect(await removeAdmin(db, "a@x.nl", "a@x.nl")).toMatchObject({
      ok: false,
      message: expect.stringContaining("cannot remove yourself"),
    });
    expect(await emails()).toEqual(["a@x.nl"]);
  });

  it("two admins removing each other at the same moment cannot lock everyone out", async () => {
    await ensureBootstrap(db, "a@x.nl,b@x.nl");
    await Promise.all([removeAdmin(db, "a@x.nl", "b@x.nl"), removeAdmin(db, "b@x.nl", "a@x.nl")]);
    expect((await emails()).length).toBeGreaterThanOrEqual(1);
  });

  it("reports an unknown email clearly", async () => {
    await ensureBootstrap(db, "a@x.nl,b@x.nl");
    expect(await removeAdmin(db, "a@x.nl", "zzz@x.nl")).toMatchObject({ ok: false, message: expect.stringContaining("not an administrator") });
  });
});

describe("last login", () => {
  it("records the first login, then at most once per hour", async () => {
    await ensureBootstrap(db, "a@x.nl");
    const t0 = new Date("2026-11-16T09:00:00.000Z");
    await touchLogin(db, "a@x.nl", t0);
    await touchLogin(db, "a@x.nl", new Date(t0.getTime() + 10 * 60_000));
    expect((await listAdmins(db))[0].last_login_at).toBe(t0.toISOString());
    const later = new Date(t0.getTime() + 2 * 3_600_000);
    await touchLogin(db, "a@x.nl", later);
    expect((await listAdmins(db))[0].last_login_at).toBe(later.toISOString());
  });
});

describe("set admin role", () => {
  it("allows super admin to change another admin's role and audits it", async () => {
    await ensureBootstrap(db, "a@x.nl");
    await addAdmin(db, "a@x.nl", "b@x.nl", "Bea", "ADMIN");

    const res = await setAdminRole(db, "a@x.nl", "b@x.nl", "SUPER_ADMIN");
    expect(res.ok).toBe(true);

    const row = (await listAdmins(db)).find((a) => a.email === "b@x.nl");
    expect(row?.role).toBe("SUPER_ADMIN");

    const audit = await db
      .prepare("SELECT action, target, detail FROM audit_log WHERE action = 'admin.role.change'")
      .first<{ detail: string }>();
    expect(audit).toMatchObject({ target: "b@x.nl" });
    expect(JSON.parse(audit!.detail).role).toBe("SUPER_ADMIN");
  });

  it("rejects non-super admin changing roles", async () => {
    await ensureBootstrap(db, "a@x.nl");
    await addAdmin(db, "a@x.nl", "b@x.nl", "Bea", "ADMIN");

    expect(await setAdminRole(db, "b@x.nl", "a@x.nl", "SUPER_ADMIN")).toMatchObject({
      ok: false,
      message: expect.stringContaining("Only a super administrator"),
    });
  });

  it("rejects unknown roles", async () => {
    await ensureBootstrap(db, "a@x.nl");
    expect(await setAdminRole(db, "a@x.nl", "a@x.nl", "OWNER" as any)).toMatchObject({
      ok: false,
      message: expect.stringContaining("Unknown administrator role"),
    });
  });

  it("prevents a super admin from demoting themselves", async () => {
    await ensureBootstrap(db, "a@x.nl");
    expect(await setAdminRole(db, "a@x.nl", "a@x.nl", "ADMIN")).toMatchObject({
      ok: false,
      message: expect.stringContaining("cannot remove your own super administrator role"),
    });
  });
});

describe("admin write permission enforcement", () => {
  it("rejects add-admin from non-super admin", async () => {
    await ensureBootstrap(db, "a@x.nl");
    await addAdmin(db, "a@x.nl", "b@x.nl", "Bea", "ADMIN");

    expect(await addAdmin(db, "b@x.nl", "c@x.nl", "Cecil")).toMatchObject({
      ok: false,
      message: expect.stringContaining("Only a super administrator"),
    });
  });

  it("rejects remove-admin from non-super admin", async () => {
    await ensureBootstrap(db, "a@x.nl");
    await addAdmin(db, "a@x.nl", "b@x.nl", "Bea", "ADMIN");

    expect(await removeAdmin(db, "b@x.nl", "a@x.nl")).toMatchObject({
      ok: false,
      message: expect.stringContaining("Only a super administrator"),
    });
  });
});

describe("admin active status", () => {
  it("isAdmin returns false for inactive admins", async () => {
    await ensureBootstrap(db, "a@x.nl");
    await db
      .prepare("UPDATE admins SET active = 0 WHERE email = ?")
      .bind("a@x.nl")
      .run();
    expect(await isAdmin(db, "a@x.nl")).toBe(false);
    expect(await getAdmin(db, "a@x.nl")).toBeNull();
  });
});
