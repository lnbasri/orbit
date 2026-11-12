import { describe, expect, it } from "vitest";

import {
  clearSessionCookie,
  isSameOrigin,
  loginPath,
  readCookie,
  safeNextPath,
  sessionCookie,
} from "../app/lib/auth.server";
import { countryName, describeDevice } from "../app/lib/email/login-code";
import { googleConfig } from "../app/lib/google-oauth.server";
import { generateCode, normalizeCode } from "../app/lib/login-codes.server";
import { bankConfigured, featureEnabled } from "../app/lib/config.server";
import { toCsv } from "../app/lib/csv";
import { verifyTurnstile } from "../app/lib/turnstile.server";
import { formToRegistrationDraft, normalizeWhatsapp, registrationSchema } from "../app/lib/validation";

describe("validation", () => {
  it("normalises WhatsApp numbers", () => {
    expect(normalizeWhatsapp("06 1234 5678")).toBe("+31612345678");
    expect(normalizeWhatsapp("0031-6-12345678")).toBe("+31612345678");
    expect(normalizeWhatsapp("+62 812 3456 7890")).toBe("+6281234567890");
  });

  function form(extra: Record<string, string> = {}) {
    const f = new FormData();
    const base: Record<string, string> = {
      registrantName: "  Budi  ",
      membership: "Ya",
      email: "Budi@Example.COM",
      whatsapp: "0612345678",
      participantCount: "2",
      p0_name: "Budi",
      p0_gender: "male",
      p0_birthYear: "1980",
      p1_name: "Ani",
      p1_gender: "female",
      p1_birthYear: "2015",
      consent: "on",
      ...extra,
    };
    for (const [k, v] of Object.entries(base)) f.append(k, v);
    return f;
  }

  it("accepts a valid family and normalises fields", () => {
    const r = registrationSchema(8, 2026).safeParse(formToRegistrationDraft(form()));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({ registrantName: "Budi", email: "budi@example.com", whatsapp: "+31612345678" });
    expect(r.data.participants[1]).toEqual({ name: "Ani", gender: "female", birthYear: 2015 });
  });

  it("requires privacy consent, valid gender and birth year", () => {
    const f = form({ p1_gender: "x", p1_birthYear: "2030" });
    f.delete("consent");
    const r = registrationSchema(8, 2026).safeParse(formToRegistrationDraft(f));
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["consent", "participants.1.gender", "participants.1.birthYear"]));
  });

  it("enforces the maximum family size", () => {
    const r = registrationSchema(1, 2026).safeParse(formToRegistrationDraft(form()));
    expect(r.success).toBe(false);
  });
});

describe("CSV export", () => {
  it("adds a BOM, quotes, and neutralises spreadsheet formulas", () => {
    const csv = toCsv([{ name: 'Ani "A", B', phone: "+31612345678", note: "=HYPERLINK(1)" }]);
    expect(csv.startsWith("﻿name,phone,note\r\n")).toBe(true);
    expect(csv).toContain('"Ani ""A"", B"');
    expect(csv).toContain("'+31612345678");
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});

describe("Turnstile verification", () => {
  const fake = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

  it("passes only when Cloudflare says success", async () => {
    expect((await verifyTurnstile("s", "tok", null, fake({ success: true }))).success).toBe(true);
    expect((await verifyTurnstile("s", "tok", null, fake({ success: false, "error-codes": ["timeout-or-duplicate"] }))).errorCodes).toEqual(["timeout-or-duplicate"]);
  });

  it("trims whitespace/line breaks around the secret and the token before sending them", async () => {
    let sent: FormData | undefined;
    const spy = (async (_url: string, init: { body: FormData }) => {
      sent = init.body;
      return new Response(JSON.stringify({ success: true }));
    }) as unknown as typeof fetch;
    expect((await verifyTurnstile("  secret-value\r\n", "\ttoken-value \n", null, spy)).success).toBe(true);
    expect(sent?.get("secret")).toBe("secret-value");
    expect(sent?.get("response")).toBe("token-value");
    expect((await verifyTurnstile("  \r\n", "tok", null, spy)).errorCodes).toEqual(["missing-secret"]);
  });

  it("fails closed without token or secret", async () => {
    expect((await verifyTurnstile("s", null, null, fake({ success: true }))).success).toBe(false);
    expect((await verifyTurnstile(undefined, "tok", null, fake({ success: true }))).success).toBe(false);
  });
});

describe("admin login helpers", () => {
  it("only allows relative /admin destinations after login", () => {
    expect(safeNextPath("/admin/registrations?status=accepted")).toBe("/admin/registrations?status=accepted");
    expect(safeNextPath("/admin")).toBe("/admin");
    for (const bad of [
      null,
      "",
      "https://evil.example/admin",
      "//evil.example/admin",
      "/\\evil.example",
      "/e/kajian",
      "/administrator",
      "/admin/login",
      "/admin/logout",
      "/admin/auth/google/callback",
      "javascript:alert(1)",
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe("/admin");
    }
    expect(loginPath("/admin")).toBe("/admin/login");
    expect(loginPath("/admin/export")).toBe("/admin/login?next=%2Fadmin%2Fexport");
  });

  it("normalises codes and generates uniform 6-digit codes", () => {
    expect(normalizeCode("123 456")).toBe("123456");
    expect(normalizeCode("123-456")).toBe("123456");
    expect(normalizeCode("12345")).toBeNull();
    expect(normalizeCode("12345a")).toBeNull();
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it("reads cookies and rejects cross-site posts", () => {
    const req = new Request("https://admin.example/admin", {
      method: "POST",
      headers: { Cookie: "a=1; __Host-ppme_admin=tok%2Ben; b=2", Origin: "https://evil.example" },
    });
    expect(readCookie(req, "__Host-ppme_admin")).toBe("tok+en");
    expect(readCookie(req, "missing")).toBeNull();
    expect(isSameOrigin(req)).toBe(false);
    expect(isSameOrigin(new Request("https://admin.example/admin", { headers: { Origin: "https://admin.example" } }))).toBe(true);
    expect(isSameOrigin(new Request("https://admin.example/admin"))).toBe(true);
  });

  it("issues host-only secure cookies on https and plain ones on http", () => {
    const https = sessionCookie(new Request("https://admin.example/admin"), "abc");
    expect(https).toMatch(/^__Host-ppme_admin=abc; Path=\/; Max-Age=86400; HttpOnly; SameSite=Lax; Secure$/);
    const http = sessionCookie(new Request("http://localhost:5173/admin"), "abc");
    expect(http).toBe("ppme_admin=abc; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax");
    expect(clearSessionCookie(new Request("https://admin.example/"))).toContain("Max-Age=0");
  });

  it("enables Google sign-in only with both client id and secret", () => {
    expect(googleConfig({})).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: "id" })).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: " id ", GOOGLE_CLIENT_SECRET: "s" })).toEqual({ clientId: "id", clientSecret: "s" });
  });

  it("describes the requesting device and country for the email", () => {
    const chromeWin =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
    expect(describeDevice(chromeWin)).toBe("Chrome di Windows");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Safari/604.1")).toBe(
      "Safari di iOS",
    );
    expect(describeDevice(null)).toBeNull();
    expect(countryName("NL")).toBe("Belanda");
    expect(countryName("XX")).toBeNull();
  });
});

describe("bank details configuration", () => {
  const env = (accountName?: string, iban?: string) =>
    ({ BANK_ACCOUNT_NAME: accountName, BANK_IBAN: iban }) as Parameters<typeof bankConfigured>[0];

  it("is configured only when both values are real", () => {
    expect(bankConfigured(env("Stichting PPME", "NL91 ABNA 0417 1643 00"))).toBe(true);
    expect(bankConfigured(env("Stichting PPME", ""))).toBe(false);
    expect(bankConfigured(env(undefined, "NL91 ABNA 0417 1643 00"))).toBe(false);
    expect(bankConfigured(env(undefined, undefined))).toBe(false);
  });

  it("treats the template placeholders as not configured", () => {
    expect(bankConfigured(env("REPLACE_WITH_ACCOUNT_NAME", "NL91 ABNA 0417 1643 00"))).toBe(false);
    expect(bankConfigured(env("Stichting PPME", "REPLACE_WITH_IBAN"))).toBe(false);
  });
});

describe("feature switches (public form / admin)", () => {
  it("both are on by default and only the string \"false\" turns one off", () => {
    expect(featureEnabled({}, "public")).toBe(true);
    expect(featureEnabled({}, "admin")).toBe(true);
    expect(featureEnabled({ ENABLE_ADMIN: "false" }, "admin")).toBe(false);
    expect(featureEnabled({ ENABLE_ADMIN: " FALSE " }, "admin")).toBe(false);
    expect(featureEnabled({ ENABLE_PUBLIC: "false" }, "public")).toBe(false);
    for (const v of ["true", "", "0", "no", "off"]) {
      expect(featureEnabled({ ENABLE_ADMIN: v, ENABLE_PUBLIC: v }, "admin")).toBe(true);
    }
  });

  it("the two switches are independent", () => {
    const publicOnly = { ENABLE_ADMIN: "false" };
    const adminOnly = { ENABLE_PUBLIC: "false" };
    expect([featureEnabled(publicOnly, "public"), featureEnabled(publicOnly, "admin")]).toEqual([true, false]);
    expect([featureEnabled(adminOnly, "public"), featureEnabled(adminOnly, "admin")]).toEqual([false, true]);
  });
});
