import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { addAdmin } from "../app/lib/admins.server";
import { createSession, identifyUser } from "../app/lib/auth.server";
import { requestLoginCode, verifyLoginCode } from "../app/lib/login-codes.server";
import {
  clearScannerSessionCookie,
  createScannerSession,
  destroyScannerSession,
  identifyScanner,
  scannerSessionCookie,
  SCANNER_SESSION_TTL_MS,
} from "../app/lib/scanner-auth.server";
import { DICTIONARY, LANGS, detectLang, t, type TextKey } from "../app/lib/scanner-i18n";
import {
  addScanners,
  deleteContact,
  linkScannerParticipant,
  linkSuggestions,
  listContacts,
  listScanners,
  parseScannerLines,
  removeScanner,
  saveContact,
  saveSelfTest,
  setScannerActive,
  setScannerRole,
  updateCheckinGate,
} from "../app/lib/scanners.server";
import { getParticipants, type EventRow } from "../app/lib/db.server";
import { registerOnline } from "../app/lib/registration.server";
import { setMembershipVerified } from "../app/lib/payments.server";
import { emailCfg, input, resetDb, startDb, T0 } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  await resetDb(db);
});

const meta = { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1", country: "NL", appOrigin: "https://checkin.example" };
const env = () => ({ DB: db, APP_ENV: "production" });
const at = (ms: number) => new Date(T0.getTime() + ms);

function cookieRequest(setCookie: string, secure = true) {
  const pair = setCookie.split(";")[0];
  return new Request(secure ? "https://checkin.example/scan" : "http://localhost/scan", { headers: { Cookie: pair } });
}

/** The code is the first word of the subject of the newest outbox email to `to`. */
async function lastCode(to: string) {
  const row = await db.prepare("SELECT subject FROM dev_outbox WHERE to_address = ? ORDER BY id DESC LIMIT 1").bind(to).first<{ subject: string }>();
  return row!.subject.split(" ")[0];
}

describe("scanner login and sessions", () => {
  it("only an active scanner receives a code; admins and strangers do not (and cannot tell)", async () => {
    await addScanners(db, "admin@x.nl", "petugas@x.nl, Petugas Satu", "scanner", T0);
    await addAdmin(db, "system", "admin@x.nl", "Admin", T0);
    expect((await requestLoginCode(db, emailCfg, "petugas@x.nl", meta, T0, "scanner")).status).toBe("sent");
    expect((await requestLoginCode(db, emailCfg, "admin@x.nl", meta, T0, "scanner")).status).toBe("skipped"); // admin is not a scanner
    expect((await requestLoginCode(db, emailCfg, "nobody@x.nl", meta, T0, "scanner")).status).toBe("skipped");
    // and the other way round: a scanner gets no admin code
    expect((await requestLoginCode(db, emailCfg, "petugas@x.nl", meta, T0, "admin")).status).toBe("skipped");
  });

  it("the code mail is bilingual and the verify result carries a machine-readable reason", async () => {
    await addScanners(db, "admin@x.nl", "petugas@x.nl", "scanner", T0);
    await requestLoginCode(db, emailCfg, "petugas@x.nl", meta, T0, "scanner");
    const mail = await db.prepare("SELECT subject, html FROM dev_outbox ORDER BY id DESC LIMIT 1").first<{ subject: string; html: string }>();
    expect(mail!.subject).toContain("kode masuk / inlogcode");
    expect(mail!.html).toContain("Inloggen op de check-in app");
    expect(mail!.html).toContain("Masuk ke aplikasi check-in");

    const code = await lastCode("petugas@x.nl");
    expect(await verifyLoginCode(db, "petugas@x.nl", "12", at(1000), "scanner")).toMatchObject({ ok: false, code: "format" });
    expect(await verifyLoginCode(db, "petugas@x.nl", code === "000000" ? "111111" : "000000", at(1000), "scanner")).toMatchObject({ ok: false, code: "invalid" });
    expect(await verifyLoginCode(db, "petugas@x.nl", code, at(2000), "scanner")).toEqual({ ok: true });
    expect(await verifyLoginCode(db, "petugas@x.nl", code, at(3000), "scanner")).toMatchObject({ ok: false }); // single use
  });

  it("a scanner code cannot be used to sign in as admin (separate tables)", async () => {
    await addScanners(db, "admin@x.nl", "petugas@x.nl", "scanner", T0);
    await requestLoginCode(db, emailCfg, "petugas@x.nl", meta, T0, "scanner");
    const code = await lastCode("petugas@x.nl");
    expect(await verifyLoginCode(db, "petugas@x.nl", code, at(1000), "admin")).toMatchObject({ ok: false });
  });

  it("session: cookie identifies the scanner, 48 h, stores only a hash, logout and deactivation end it", async () => {
    await addScanners(db, "admin@x.nl", "petugas@x.nl, Petugas Satu", "lead", T0);
    const s = await createScannerSession(db, "Petugas@X.nl", meta, T0);
    expect(s).not.toBeNull();
    expect(Date.parse(s!.expiresAt) - T0.getTime()).toBe(SCANNER_SESSION_TTL_MS);

    const stored = await db.prepare("SELECT token_hash, device_label FROM scanner_sessions").first<{ token_hash: string; device_label: string }>();
    expect(stored!.token_hash).not.toContain(s!.token);
    expect(stored!.device_label).toBe("Safari di iOS");

    const cookie = scannerSessionCookie(new Request("https://checkin.example/scan"), s!.token);
    expect(cookie).toContain("__Host-ppme_scan=");
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    const req = cookieRequest(cookie);
    const who = await identifyScanner(req, env(), at(60_000));
    expect(who).toMatchObject({ email: "petugas@x.nl", role: "lead", name: "Petugas Satu", deviceLabel: "Safari di iOS" });
    expect(await identifyScanner(req, env(), at(SCANNER_SESSION_TTL_MS + 1000))).toBeNull(); // expired

    // deactivating ends access at once
    expect((await setScannerActive(db, "admin@x.nl", who!.id, false, at(100_000))).ok).toBe(true);
    expect(await identifyScanner(req, env(), at(120_000))).toBeNull();
    expect((await setScannerActive(db, "admin@x.nl", who!.id, true, at(130_000))).ok).toBe(true);
    expect(await identifyScanner(req, env(), at(140_000))).toBeNull(); // sessions were deleted, a new login is needed

    // logout
    const s2 = await createScannerSession(db, "petugas@x.nl", meta, at(150_000));
    const req2 = cookieRequest(scannerSessionCookie(new Request("https://checkin.example/scan"), s2!.token));
    expect(await identifyScanner(req2, env(), at(160_000))).not.toBeNull();
    await destroyScannerSession(db, req2);
    expect(await identifyScanner(req2, env(), at(170_000))).toBeNull();
    expect(clearScannerSessionCookie(req2)).toContain("Max-Age=0");
  });

  it("no session for an unknown or inactive email, and no cookie means no access", async () => {
    expect(await createScannerSession(db, "nobody@x.nl", meta, T0)).toBeNull();
    expect(await identifyScanner(new Request("https://checkin.example/scan"), env(), T0)).toBeNull();
    expect(await identifyScanner(new Request("https://checkin.example/scan", { headers: { Cookie: "__Host-ppme_scan=short" } }), env(), T0)).toBeNull();
  });

  it("scanner and admin sessions are separate: a scanner cookie is no admin session and vice versa", async () => {
    await addScanners(db, "admin@x.nl", "petugas@x.nl", "scanner", T0);
    await addAdmin(db, "system", "admin@x.nl", "Admin", T0);
    const scanSession = await createScannerSession(db, "petugas@x.nl", meta, T0);
    const adminSession = await createSession(db, "admin@x.nl", "pin", meta, T0);
    const asAdminCookie = (token: string) => new Request("https://admin.example/admin", { headers: { Cookie: `__Host-ppme_admin=${token}` } });
    const asScanCookie = (token: string) => new Request("https://checkin.example/scan", { headers: { Cookie: `__Host-ppme_scan=${token}` } });
    expect((await identifyUser(asAdminCookie(scanSession!.token), env(), at(1000))).ok).toBe(false);
    expect(await identifyScanner(asScanCookie(adminSession!.token), env(), at(1000))).toBeNull();
    expect((await identifyUser(asAdminCookie(adminSession!.token), env(), at(1000))).ok).toBe(true);
  });

  it("the development bypass needs APP_ENV=development and an existing active scanner", async () => {
    await addScanners(db, "admin@x.nl", "dev@x.nl", "scanner", T0);
    const req = new Request("http://localhost/scan");
    expect(await identifyScanner(req, { DB: db, APP_ENV: "production", DEV_SCANNER_EMAIL: "dev@x.nl" }, T0)).toBeNull();
    expect(await identifyScanner(req, { DB: db, APP_ENV: "development", DEV_SCANNER_EMAIL: "dev@x.nl" }, T0)).toMatchObject({ email: "dev@x.nl" });
    expect(await identifyScanner(req, { DB: db, APP_ENV: "development", DEV_SCANNER_EMAIL: "ghost@x.nl" }, T0)).toBeNull();
  });
});

describe("managing the scanning team", () => {
  it("the first scanner lead is seeded by the migration (verified on a fresh database)", async () => {
    // resetDb wiped it; the migration SQL itself is what seeds it, so run just that statement on a clean table
    await db
      .prepare("INSERT OR IGNORE INTO scanners (email, name, role, added_by, added_at) VALUES ('rostiarso@gmail.com', NULL, 'lead', 'migration-0017', '2026-11-14T12:00:00.000Z')")
      .run();
    const rows = await listScanners(db, T0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "rostiarso@gmail.com", role: "lead", active: 1 });
  });

  it("parses 'email, name' lines, dedupes and ignores junk", () => {
    expect(parseScannerLines("a@x.nl, Ayu Putri\nB@X.NL;Budi\njunk line\na@x.nl\n\nc@x.nl")).toEqual([
      { email: "a@x.nl", name: null },
      { email: "b@x.nl", name: "Budi" },
      { email: "c@x.nl", name: null },
    ]);
  });

  it("add, role, remove: audited; duplicates are skipped", async () => {
    expect(await addScanners(db, "admin@x.nl", "a@x.nl, Ayu\nb@x.nl, Budi", "scanner", T0)).toMatchObject({ ok: true });
    expect(await addScanners(db, "admin@x.nl", "a@x.nl", "scanner", T0)).toMatchObject({ ok: false });
    expect(await addScanners(db, "admin@x.nl", "not an email", "scanner", T0)).toMatchObject({ ok: false });
    const [a] = await listScanners(db, T0);
    expect((await setScannerRole(db, "admin@x.nl", a.id, "lead", T0)).ok).toBe(true);
    expect((await setScannerRole(db, "admin@x.nl", a.id, "lead", T0)).ok).toBe(false); // unchanged
    expect((await removeScanner(db, "admin@x.nl", a.id, T0)).ok).toBe(true);
    expect(await listScanners(db, T0)).toHaveLength(1);
    const audit = await db.prepare("SELECT action FROM audit_log ORDER BY id").all<{ action: string }>();
    expect(audit.results.map((r) => r.action)).toEqual(["scanner.add", "scanner.role", "scanner.remove"]);
  });

  it("suggests linking a scanner to a participant with the same name in another registration", async () => {
    const event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
    const data = input({ people: 2 });
    const res = await registerOnline(db, event, data, { now: T0, ignoreWindow: true });
    if (res.kind !== "pending_membership") throw new Error(res.kind);
    await setMembershipVerified(db, res.registrationId, "admin@test", true, T0);
    const second = (await getParticipants(db, res.registrationId))[1];
    await addScanners(db, "admin@x.nl", `volunteer@x.nl, ${second.full_name}`, "scanner", T0);
    const scanners = await listScanners(db, T0);
    const hints = await linkSuggestions(db, scanners);
    expect(hints).toHaveLength(1);
    expect(hints[0].participantId).toBe(second.id);
    expect((await linkScannerParticipant(db, "admin@x.nl", scanners[0].id, second.id, T0)).ok).toBe(true);
    expect((await listScanners(db, T0))[0].linked_name).toBe(second.full_name);
    expect((await linkScannerParticipant(db, "admin@x.nl", scanners[0].id, "no-such-participant", T0)).ok).toBe(false);
  });

  it("self-test result is recomputed on the server: a failure anywhere means not passed", async () => {
    await addScanners(db, "admin@x.nl", "a@x.nl", "scanner", T0);
    const [a] = await listScanners(db, T0);
    expect(await saveSelfTest(db, a.id, "Safari di iOS", { appVersion: "1.0.0", passed: true, items: { camera: "pass", network: "fail" } }, T0)).toEqual({ passed: false });
    expect(await saveSelfTest(db, a.id, "Safari di iOS", { appVersion: "1.0.0", passed: false, items: { camera: "pass", clock: "warn", evil: "<script>" } }, at(1000))).toEqual({ passed: true });
    const rows = await listScanners(db, at(2000));
    expect(rows[0]).toMatchObject({ test_passed: 1, test_device: "Safari di iOS" });
    const stored = await db.prepare("SELECT result_json FROM scanner_selftests ORDER BY id DESC LIMIT 1").first<{ result_json: string }>();
    expect(JSON.parse(stored!.result_json)).toEqual({ camera: "pass", clock: "warn" }); // unknown statuses are dropped
  });

  it("escalation contacts: validated, listed by level, editable, empty by default", async () => {
    expect(await listContacts(db)).toEqual([]);
    expect(await saveContact(db, "admin@x.nl", { level: "9", name: "X", roleLabel: "", phone: "+31612345678", note: "" }, T0)).toMatchObject({ ok: false });
    expect(await saveContact(db, "admin@x.nl", { level: "1", name: "", roleLabel: "", phone: "+31612345678", note: "" }, T0)).toMatchObject({ ok: false });
    expect(await saveContact(db, "admin@x.nl", { level: "1", name: "Pak Keamanan", roleLabel: "Kepala keamanan", phone: "abc", note: "" }, T0)).toMatchObject({ ok: false });
    expect(await saveContact(db, "admin@x.nl", { level: "2", name: "Ibu Panitia", roleLabel: "", phone: "06 12345678", note: "" }, T0)).toMatchObject({ ok: true });
    expect(await saveContact(db, "admin@x.nl", { level: "1", name: "Pak Keamanan", roleLabel: "Kepala keamanan", phone: "+31 6 87654321", note: "" }, T0)).toMatchObject({ ok: true });
    let list = await listContacts(db);
    expect(list.map((c) => [c.level, c.name, c.phone])).toEqual([[1, "Pak Keamanan", "+31687654321"], [2, "Ibu Panitia", "+31612345678"]]);
    expect((await saveContact(db, "admin@x.nl", { id: list[0].id, level: "3", name: "Pak Bestuur", roleLabel: "", phone: "+31687654321", note: "" }, T0)).ok).toBe(true);
    expect((await listContacts(db)).find((c) => c.id === list[0].id)).toMatchObject({ level: 3, name: "Pak Bestuur" });
    expect((await deleteContact(db, "admin@x.nl", list[1].id, T0)).ok).toBe(true);
    list = await listContacts(db);
    expect(list).toHaveLength(1);
  });

  it("gate settings: window must be ordered, switch is audited", async () => {
    const event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
    expect(await updateCheckinGate(db, "admin@x.nl", event, { enabled: true, opensAt: "2026-12-05T10:00:00.000Z", closesAt: "2026-12-05T09:00:00.000Z" }, T0)).toMatchObject({ ok: false });
    expect((await updateCheckinGate(db, "admin@x.nl", event, { enabled: false, opensAt: "", closesAt: "" }, T0)).ok).toBe(true);
    const row = await db.prepare("SELECT checkin_enabled, checkin_opens_at FROM events").first<{ checkin_enabled: number; checkin_opens_at: string | null }>();
    expect(row).toEqual({ checkin_enabled: 0, checkin_opens_at: null });
    expect((await db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'event.checkin_gate'").first<{ n: number }>())!.n).toBe(1);
  });
});

describe("Indonesian and Dutch texts", () => {
  const keys = Object.keys(DICTIONARY.id) as TextKey[];

  it("both languages have exactly the same keys, no empty text, and the same placeholders", () => {
    expect(Object.keys(DICTIONARY.nl).sort()).toEqual([...keys].sort());
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of keys) {
      for (const lang of LANGS) expect(DICTIONARY[lang][key].trim().length, `${lang}.${key}`).toBeGreaterThan(0);
      expect(placeholders(DICTIONARY.nl[key]), key).toEqual(placeholders(DICTIONARY.id[key]));
    }
  });

  it("long texts differ between the languages (no copied Indonesian left in the Dutch)", () => {
    const same = keys.filter((k) => DICTIONARY.id[k].length > 25 && DICTIONARY.id[k] === DICTIONARY.nl[k]);
    expect(same).toEqual([]);
  });

  it("every reason code has a title and an instruction in both languages", () => {
    for (const code of ["unknown_code", "ticket_revoked", "already_in", "not_accepted", "payment_unclear", "gate_before", "gate_after", "checkin_off", "own_ticket", "wrong_event"]) {
      for (const lang of LANGS) {
        expect(t(lang, `r_${code}` as TextKey).length).toBeGreaterThan(3);
        expect(t(lang, `a_${code}` as TextKey).length).toBeGreaterThan(10);
      }
    }
  });

  it("language detection: cookie wins, then Accept-Language (nl = Dutch), default Indonesian", () => {
    expect(detectLang("ppme_lang=nl", "id-ID")).toBe("nl");
    expect(detectLang("a=b; ppme_lang=id", "nl-NL")).toBe("id");
    expect(detectLang(null, "nl-NL,nl;q=0.9")).toBe("nl");
    expect(detectLang(null, "en-US")).toBe("id");
    expect(detectLang("ppme_lang=xx", null)).toBe("id");
    expect(t("nl", "insideCount", { inside: 3, expected: 10 })).toBe("3 van 10 binnen");
  });
});
