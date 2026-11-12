import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { addAdmin, removeAdmin } from "../app/lib/admins.server";
import { createSession, destroySession, identifyUser, SESSION_TTL_MS } from "../app/lib/auth.server";
import {
  CODE_COOLDOWN_MS,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  requestLoginCode,
  verifyLoginCode,
} from "../app/lib/login-codes.server";
import { emailCfg, resetDb, startDb, T0 } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  await resetDb(db);
  await addAdmin(db, "system", "admin@x.nl", "Admin", T0);
  await addAdmin(db, "system", "other@x.nl", "Other", T0);
});

const at = (ms: number) => new Date(T0.getTime() + ms);
const meta = { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", country: "NL", appOrigin: "https://admin.example" };

/** The code is the first word of the subject of the newest outbox email to `to`. */
async function lastCode(to: string) {
  const row = await db
    .prepare("SELECT subject, html, kind, registration_id FROM dev_outbox WHERE to_address = ? ORDER BY id DESC LIMIT 1")
    .bind(to)
    .first<{ subject: string; html: string; kind: string; registration_id: string | null }>();
  return row ? { code: row.subject.split(" ")[0], ...row } : null;
}

const outboxCount = async () => (await db.prepare("SELECT COUNT(*) AS n FROM dev_outbox").first<{ n: number }>())!.n;

function requestWithCookie(token: string) {
  return new Request("https://admin.example/admin", { headers: { Cookie: `__Host-ppme_admin=${token}` } });
}
const prodEnv = () => ({ APP_ENV: "production", DB: db });

describe("login code request", () => {
  it("emails a 6-digit code to an admin, stores only a hash, and is not tied to a registration", async () => {
    const res = await requestLoginCode(db, emailCfg, "  Admin@X.nl ", meta, T0);
    expect(res.status).toBe("sent");
    const mail = await lastCode("admin@x.nl");
    expect(mail?.code).toMatch(/^\d{6}$/);
    expect(mail?.kind).toBe("login_code");
    expect(mail?.registration_id).toBeNull();
    expect(mail?.html).toContain(mail!.code);
    expect(mail?.html).toContain("https://admin.example/logo-ppme.png");
    expect(mail?.html).toContain("Belanda");

    const row = await db.prepare("SELECT * FROM admin_login_codes").first<Record<string, string>>();
    expect(row?.email).toBe("admin@x.nl");
    expect(JSON.stringify(row)).not.toContain(mail!.code);
  });

  it("sends nothing to an unknown email but answers the same way", async () => {
    expect((await requestLoginCode(db, emailCfg, "stranger@x.nl", meta, T0)).status).toBe("skipped");
    expect(await outboxCount()).toBe(0);
  });

  it("allows one code per minute and five per hour per email", async () => {
    expect((await requestLoginCode(db, emailCfg, "admin@x.nl", meta, T0)).status).toBe("sent");
    expect((await requestLoginCode(db, emailCfg, "admin@x.nl", meta, at(30_000))).status).toBe("skipped");
    // another admin is not affected
    expect((await requestLoginCode(db, emailCfg, "other@x.nl", meta, at(30_000))).status).toBe("sent");

    for (let i = 1; i < 5; i++) {
      expect((await requestLoginCode(db, emailCfg, "admin@x.nl", meta, at(i * (CODE_COOLDOWN_MS + 1)))).status).toBe("sent");
    }
    expect((await requestLoginCode(db, emailCfg, "admin@x.nl", meta, at(5 * (CODE_COOLDOWN_MS + 1)))).status).toBe("skipped");
    expect((await requestLoginCode(db, emailCfg, "admin@x.nl", meta, at(3_600_000 + 1))).status).toBe("sent");
  });

  it("drops the code when the email provider fails, so a retry is possible at once", async () => {
    const broken = { ...emailCfg, mode: "resend" as const, resendApiKey: undefined };
    expect((await requestLoginCode(db, broken, "admin@x.nl", meta, T0)).status).toBe("failed");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM admin_login_codes").first<{ n: number }>())!.n).toBe(0);
    expect((await requestLoginCode(db, emailCfg, "admin@x.nl", meta, at(1000))).status).toBe("sent");
  });
});

describe("login code verification", () => {
  it("accepts the right code once (spaces allowed), case-insensitive email", async () => {
    await requestLoginCode(db, emailCfg, "admin@x.nl", meta, T0);
    const { code } = (await lastCode("admin@x.nl"))!;
    expect(await verifyLoginCode(db, "ADMIN@x.nl", `${code.slice(0, 3)} ${code.slice(3)}`, at(60_000))).toEqual({ ok: true });
    expect((await verifyLoginCode(db, "admin@x.nl", code, at(61_000))).ok).toBe(false);
  });

  it("rejects a code after 10 minutes", async () => {
    await requestLoginCode(db, emailCfg, "admin@x.nl", meta, T0);
    const { code } = (await lastCode("admin@x.nl"))!;
    expect((await verifyLoginCode(db, "admin@x.nl", code, at(CODE_TTL_MS + 1))).ok).toBe(false);
  });

  it("locks the code after five wrong attempts, even if the sixth is right", async () => {
    await requestLoginCode(db, emailCfg, "admin@x.nl", meta, T0);
    const { code } = (await lastCode("admin@x.nl"))!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i <= CODE_MAX_ATTEMPTS; i++) {
      const res = await verifyLoginCode(db, "admin@x.nl", wrong, at(i * 1000));
      expect(res.ok).toBe(false);
      if (i === CODE_MAX_ATTEMPTS && !res.ok) expect(res.message).toContain("Terlalu banyak");
    }
    expect((await verifyLoginCode(db, "admin@x.nl", code, at(10_000))).ok).toBe(false);
  });

  it("only the newest code counts", async () => {
    await requestLoginCode(db, emailCfg, "admin@x.nl", meta, T0);
    const first = (await lastCode("admin@x.nl"))!.code;
    await requestLoginCode(db, emailCfg, "admin@x.nl", meta, at(CODE_COOLDOWN_MS + 1));
    const second = (await lastCode("admin@x.nl"))!.code;
    if (first !== second) expect((await verifyLoginCode(db, "admin@x.nl", first, at(CODE_COOLDOWN_MS + 2))).ok).toBe(false);
    expect((await verifyLoginCode(db, "admin@x.nl", second, at(CODE_COOLDOWN_MS + 3))).ok).toBe(true);
  });

  it("does not let one email's code open another account", async () => {
    await requestLoginCode(db, emailCfg, "admin@x.nl", meta, T0);
    const { code } = (await lastCode("admin@x.nl"))!;
    expect((await verifyLoginCode(db, "other@x.nl", code, at(1000))).ok).toBe(false);
  });

  it("parallel guesses cannot exceed the attempt limit", async () => {
    await requestLoginCode(db, emailCfg, "admin@x.nl", meta, T0);
    const { code } = (await lastCode("admin@x.nl"))!;
    const wrong = code === "000000" ? "111111" : "000000";
    await Promise.all(Array.from({ length: 12 }, () => verifyLoginCode(db, "admin@x.nl", wrong, at(1000))));
    const row = await db.prepare("SELECT attempts FROM admin_login_codes").first<{ attempts: number }>();
    expect(row?.attempts).toBe(CODE_MAX_ATTEMPTS);
  });
});

describe("sessions", () => {
  it("are valid for 24 hours and identify the admin", async () => {
    const s = (await createSession(db, "Admin@x.nl", "pin", meta, T0))!;
    expect(s.token.length).toBeGreaterThanOrEqual(43);
    expect(new Date(s.expiresAt).getTime() - T0.getTime()).toBe(SESSION_TTL_MS);

    const req = requestWithCookie(s.token);
    expect(await identifyUser(req, prodEnv(), at(SESSION_TTL_MS - 1000))).toEqual({ ok: true, email: "admin@x.nl", method: "pin" });
    expect((await identifyUser(req, prodEnv(), at(SESSION_TTL_MS + 1))).ok).toBe(false);

    const stored = await db.prepare("SELECT token_hash FROM admin_sessions").first<{ token_hash: string }>();
    expect(stored?.token_hash).not.toBe(s.token);
  });

  it("are refused for non-admins and end when the admin is removed", async () => {
    expect(await createSession(db, "stranger@x.nl", "google", meta, T0)).toBeNull();

    const s = (await createSession(db, "other@x.nl", "google", meta, T0))!;
    expect((await identifyUser(requestWithCookie(s.token), prodEnv(), at(1000))).ok).toBe(true);
    expect((await removeAdmin(db, "admin@x.nl", "other@x.nl", at(2000))).ok).toBe(true);
    expect((await identifyUser(requestWithCookie(s.token), prodEnv(), at(3000))).ok).toBe(false);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM admin_sessions").first<{ n: number }>())!.n).toBe(0);
  });

  it("end on logout and ignore forged or missing cookies", async () => {
    const s = (await createSession(db, "admin@x.nl", "pin", meta, T0))!;
    await destroySession(db, requestWithCookie(s.token), at(1000));
    expect((await identifyUser(requestWithCookie(s.token), prodEnv(), at(2000))).ok).toBe(false);
    expect((await identifyUser(requestWithCookie("x".repeat(43)), prodEnv(), at(2000))).ok).toBe(false);
    expect((await identifyUser(new Request("https://admin.example/admin"), prodEnv(), at(2000))).ok).toBe(false);
    // the http cookie name is not accepted on https
    const plain = new Request("https://admin.example/admin", { headers: { Cookie: `ppme_admin=${s.token}` } });
    expect((await identifyUser(plain, prodEnv(), at(500))).ok).toBe(false);
  });

  it("uses the development identity only in development", async () => {
    const req = new Request("https://admin.example/admin");
    expect(await identifyUser(req, { APP_ENV: "development", DEV_ADMIN_EMAIL: "A@x.nl", DB: db })).toEqual({
      ok: true,
      email: "a@x.nl",
      method: "dev",
    });
    expect((await identifyUser(req, { APP_ENV: "production", DEV_ADMIN_EMAIL: "a@x.nl", DB: db })).ok).toBe(false);
  });

  it("logins are audited without the code", async () => {
    await requestLoginCode(db, emailCfg, "admin@x.nl", meta, T0);
    const { code } = (await lastCode("admin@x.nl"))!;
    await verifyLoginCode(db, "admin@x.nl", code, at(1000));
    await createSession(db, "admin@x.nl", "pin", meta, at(1000));
    const { results } = await db.prepare("SELECT action, detail FROM audit_log ORDER BY id").all<{ action: string; detail: string }>();
    expect(results.map((r) => r.action)).toEqual(expect.arrayContaining(["auth.code_sent", "auth.login"]));
    expect(JSON.stringify(results)).not.toContain(code);
  });
});
