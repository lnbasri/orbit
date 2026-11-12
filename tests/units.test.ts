import { describe, expect, it } from "vitest";

import { identifyUser } from "../app/lib/auth.server";
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

describe("admin identity (Access JWT / dev stub)", () => {
  const req = new Request("https://example.com/admin");

  it("uses the dev identity only in development", async () => {
    expect(await identifyUser(req, { APP_ENV: "development", DEV_ADMIN_EMAIL: "A@x.nl" })).toEqual({ ok: true, email: "a@x.nl" });
    expect((await identifyUser(req, { APP_ENV: "production", DEV_ADMIN_EMAIL: "a@x.nl" })).ok).toBe(false);
  });

  it("fails closed in production when Access is not configured or no token is sent", async () => {
    expect(await identifyUser(req, { APP_ENV: "production" })).toMatchObject({ ok: false, status: 403 });
    expect(
      await identifyUser(req, { APP_ENV: "production", ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "aud" }),
    ).toMatchObject({ ok: false, status: 401 });
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
