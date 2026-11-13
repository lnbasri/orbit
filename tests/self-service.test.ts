import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getParticipants, getRegistration, type EventRow } from "../app/lib/db.server";
import { deliverEmail } from "../app/lib/email/send.server";
import { TICKET_TOKEN_PATTERN } from "../app/lib/ids";
import { confirmPayment } from "../app/lib/payments.server";
import {
  createRegistrantSession,
  identifyRegistrant,
  requestRegistrantCode,
  verifyRegistrantCode,
} from "../app/lib/registrant-access.server";
import { registerOnline } from "../app/lib/registration.server";
import { selfEditState, updateOwnRegistration } from "../app/lib/self-service.server";
import type { SelfEditInput } from "../app/lib/validation";
import { T0, emailCfg, hours, input, resetDb, startDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;
let event: EventRow;

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  event = await resetDb(db);
  await db
    .prepare("UPDATE events SET status = 'open', registration_closes_at = ?, starts_at = ?")
    .bind("2026-11-27T22:59:00.000Z", "2026-12-05T08:00:00.000Z")
    .run();
  event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
});

const cfg = { ...emailCfg, publicUrl: "https://public.example" };
const meta = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (iPhone) Safari/605.1", country: "NL", appOrigin: "https://public.example" };

async function register(overrides: Parameters<typeof input>[0] = {}) {
  const data = input(overrides);
  const res = await registerOnline(db, event, data, { now: T0, ignoreWindow: true });
  if (res.kind !== "accepted" && res.kind !== "pending_payment") throw new Error(res.kind);
  return { id: res.registrationId, email: data.email };
}

/** The current state of a registration as an edit input (ids kept). */
async function currentInput(id: string): Promise<SelfEditInput> {
  const reg = (await getRegistration(db, id))!;
  const parts = await getParticipants(db, id);
  return {
    registrantName: reg.registrant_name,
    whatsapp: reg.whatsapp!,
    participants: parts.map((p) => ({ id: p.id, name: p.full_name, gender: p.gender!, ageGroup: p.age_group })),
  };
}

const rev = async (id: string) => (await getRegistration(db, id))!.edit_rev ?? "";
const emailRow = (id: string, kind: string) =>
  db.prepare("SELECT * FROM email_log WHERE registration_id = ? AND kind = ?").bind(id, kind).first<Record<string, unknown>>();
const lastMail = (id: string) =>
  db
    .prepare("SELECT subject, html, attachments_json FROM dev_outbox WHERE registration_id = ? ORDER BY id DESC LIMIT 1")
    .bind(id)
    .first<{ subject: string; html: string; attachments_json: string }>();

describe("registrant access code", () => {
  it("is emailed only to an email with an active registration for the event, and opens a session", async () => {
    const { email } = await register();
    expect((await requestRegistrantCode(db, cfg, event, "nobody@example.com", meta, T0)).status).toBe("skipped");
    expect((await requestRegistrantCode(db, cfg, event, email.toUpperCase(), meta, T0)).status).toBe("sent");

    const mail = await db
      .prepare("SELECT subject, html, kind FROM dev_outbox WHERE to_address = ? ORDER BY id DESC LIMIT 1")
      .bind(email)
      .first<{ subject: string; html: string; kind: string }>();
    expect(mail?.kind).toBe("registrant_code");
    const code = mail!.subject.split(" ")[0];
    expect(code).toMatch(/^\d{6}$/);
    expect(mail!.html).toContain("/e/kajian-aisah-dahlan-2026/pendaftaran-saya");
    expect(mail!.html).not.toContain("Dashboard Panitia");

    // cooldown: a second request within a minute sends nothing
    expect((await requestRegistrantCode(db, cfg, event, email, meta, new Date(T0.getTime() + 30_000))).status).toBe("skipped");
    expect((await verifyRegistrantCode(db, event.id, email, "000000", T0)).ok).toBe(code === "000000");
    expect((await verifyRegistrantCode(db, event.id, email, code, T0)).ok).toBe(true);
    // single use
    expect((await verifyRegistrantCode(db, event.id, email, code, T0)).ok).toBe(false);

    const session = await createRegistrantSession(db, event.id, email, meta, T0);
    expect(session).not.toBeNull();
    const req = new Request("https://public.example/x", { headers: { Cookie: `__Host-ppme_reg=${session!.token}` } });
    expect(await identifyRegistrant(db, req, event.id, T0)).toEqual({ email });
    expect(await identifyRegistrant(db, req, event.id + 1, T0)).toBeNull();
    expect(await identifyRegistrant(db, req, event.id, hours(3))).toBeNull();
    // an admin cookie with the same token is not a registrant session (separate tables and cookie names)
    const adminReq = new Request("https://public.example/x", { headers: { Cookie: `__Host-ppme_admin=${session!.token}` } });
    expect(await identifyRegistrant(db, adminReq, event.id, T0)).toBeNull();
  });

  it("no session for an email without an active registration", async () => {
    expect(await createRegistrantSession(db, event.id, "nobody@example.com", meta, T0)).toBeNull();
  });
});

describe("member self-service edit", () => {
  it("renames, adds and removes participants; new participant gets a ticket, removed one's ticket is gone", async () => {
    const { id, email } = await register({ people: 2 });
    const before = await getParticipants(db, id);
    const edit = await currentInput(id);
    edit.registrantName = "Nama Baru";
    edit.participants = [
      { ...edit.participants[1], name: "Anak Diganti" }, // keep #2 (moves to position 1)
      { name: "Peserta Tambahan", gender: "perempuan", ageGroup: "remaja" }, // new
    ]; // #1 removed

    const res = await updateOwnRegistration(db, event, email, "", edit, { now: T0 });
    expect(res).toMatchObject({ ok: true, changed: true, email: "confirmation", people: 2 });

    const reg = (await getRegistration(db, id))!;
    expect(reg.registrant_name).toBe("Nama Baru");
    expect(reg.edit_rev).toBeTruthy();
    const after = await getParticipants(db, id);
    expect(after.map((p) => [p.position, p.full_name])).toEqual([
      [1, "Anak Diganti"],
      [2, "Peserta Tambahan"],
    ]);
    // the kept participant keeps their ticket code; the removed one's code no longer exists
    expect(after[0].id).toBe(before[1].id);
    expect(after[0].qr_token).toBe(before[1].qr_token);
    expect(after[1].qr_token).toMatch(TICKET_TOKEN_PATTERN);
    expect(after[1].status).toBe("accepted");
    expect(after.some((p) => p.qr_token === before[0].qr_token)).toBe(false);

    // outbox: the confirmation is re-queued in the same batch, then sent with the update notice and the link
    expect(await emailRow(id, "confirmation")).toMatchObject({ status: "pending", attempts: 0 });
    expect((await deliverEmail(db, cfg, id, "confirmation", { now: T0 })).ok).toBe(true);
    const mail = (await lastMail(id))!;
    expect(mail.subject).toMatch(/^Pembaruan Konfirmasi/);
    expect(mail.html).toContain("telah diperbarui");
    expect(mail.html).toContain("https://public.example/e/kajian-aisah-dahlan-2026/pendaftaran-saya");
    expect(mail.html).toContain("Peserta Tambahan");
    // same "Ketentuan pendaftaran" as the public form, incl. the former "Catatan penting"
    expect(mail.html).toContain("Ketentuan Pendaftaran");
    expect(mail.html).toContain("Pendaftaran ditutup otomatis apabila kuota peserta sudah terpenuhi.");
    expect(mail.html).toContain("periksa juga folder spam");
    expect(JSON.parse(mail.attachments_json)).toHaveLength(2);

    const audit = await db.prepare("SELECT * FROM audit_log WHERE action = 'registration.self_edit'").first<{ actor: string }>();
    expect(audit?.actor).toBe(email);
  });

  it("returns changed:false and writes nothing when nothing changed; WhatsApp-only change sends no email", async () => {
    const { id, email } = await register();
    expect(await updateOwnRegistration(db, event, email, "", await currentInput(id), { now: T0 })).toEqual({
      ok: true,
      changed: false,
    });
    const edit = { ...(await currentInput(id)), whatsapp: "+31699999999" };
    expect(await updateOwnRegistration(db, event, email, "", edit, { now: T0 })).toMatchObject({ ok: true, email: null });
    expect((await getRegistration(db, id))!.whatsapp).toBe("+31699999999");
  });

  it("rejects a stale revision (second tab) and a participant id of another registration", async () => {
    const { id, email } = await register({ people: 2 });
    const other = await register();
    const first = { ...(await currentInput(id)), registrantName: "Tab Satu" };
    expect((await updateOwnRegistration(db, event, email, "", first, { now: T0 })).ok).toBe(true);
    const second = { ...first, registrantName: "Tab Dua" };
    expect(await updateOwnRegistration(db, event, email, "", second, { now: T0 })).toMatchObject({ ok: false, reason: "stale" });

    const foreign = await currentInput(id);
    foreign.participants[0].id = (await getParticipants(db, other.id))[0].id;
    expect(await updateOwnRegistration(db, event, email, await rev(id), foreign, { now: T0 })).toMatchObject({
      ok: false,
      reason: "stale",
    });
    expect((await getRegistration(db, id))!.registrant_name).toBe("Tab Satu");
  });

  it("parallel edits from the same revision: exactly one wins", async () => {
    const { id, email } = await register();
    const a = { ...(await currentInput(id)), registrantName: "A" };
    const b = { ...(await currentInput(id)), registrantName: "B" };
    const results = await Promise.all([
      updateOwnRegistration(db, event, email, "", a, { now: T0 }),
      updateOwnRegistration(db, event, email, "", b, { now: T0 }),
    ]);
    expect(results.filter((r) => r.ok).length).toBe(1);
  });

  it("adding participants respects the quota atomically", async () => {
    event = await resetDb(db, { member: 3 });
    await db.prepare("UPDATE events SET registration_closes_at = ?").bind("2026-11-27T22:59:00.000Z").run();
    const { id, email } = await register({ people: 2 });
    const edit = await currentInput(id);
    edit.participants.push(
      { name: "X", gender: "laki-laki", ageGroup: "dewasa" },
      { name: "Y", gender: "laki-laki", ageGroup: "dewasa" },
    );
    const res = await updateOwnRegistration(db, event, email, "", edit, { now: T0 });
    expect(res).toMatchObject({ ok: false, reason: "quota" });
    expect(await getParticipants(db, id)).toHaveLength(2);

    edit.participants.pop(); // 3 = exactly the quota
    expect((await updateOwnRegistration(db, event, email, "", edit, { now: T0 })).ok).toBe(true);
    expect((await getRegistration(db, id))!.people).toBe(3);
  });

  it("is locked after registration closes", async () => {
    const { id, email } = await register();
    const late = new Date("2026-11-28T10:00:00.000Z");
    const reg = (await getRegistration(db, id))!;
    expect(selfEditState(reg, event, late)).toEqual({ editable: false, reason: "closed" });
    const edit = { ...(await currentInput(id)), registrantName: "Telat" };
    expect(await updateOwnRegistration(db, event, email, "", edit, { now: late })).toMatchObject({ ok: false, reason: "locked" });
  });
});

describe("non-member self-service edit", () => {
  it("before payment: count change recalculates the amount and re-queues the payment instructions", async () => {
    const { id, email } = await register({ membership: "Tidak", people: 1 });
    const before = (await getRegistration(db, id))!;
    expect(selfEditState(before, event, T0)).toMatchObject({ editable: true, until: before.pay_deadline });
    const edit = await currentInput(id);
    edit.participants.push({ name: "Istri", gender: "perempuan", ageGroup: "dewasa" });

    const res = await updateOwnRegistration(db, event, email, "", edit, { now: T0 });
    expect(res).toMatchObject({ ok: true, email: "payment_instructions", people: 2 });
    const reg = (await getRegistration(db, id))!;
    expect(reg.amount_cents).toBe(2 * event.price_non_member_cents);
    expect(reg.payment_code).toBe(before.payment_code);
    expect(reg.pay_deadline).toBe(before.pay_deadline);
    const parts = await getParticipants(db, id);
    expect(parts.map((p) => [p.status, p.qr_token])).toEqual([
      ["pending_payment", null],
      ["pending_payment", null],
    ]);

    expect((await deliverEmail(db, cfg, id, "payment_instructions", { now: T0 })).ok).toBe(true);
    const mail = (await lastMail(id))!;
    expect(mail.subject).toMatch(/^Pembaruan Instruksi Pembayaran/);
    expect(mail.html).toContain("sebelum pembayaran Anda dikonfirmasi panitia");
    expect(mail.html).toContain("Ketentuan Pendaftaran");

    // the admin confirmation still works and issues a ticket for every (current) participant
    expect((await confirmPayment(db, id, "admin@x.nl", hours(1))).ok).toBe(true);
    expect((await getParticipants(db, id)).every((p) => p.status === "accepted" && p.qr_token)).toBe(true);
  });

  it("after the payment is confirmed: view only, and the confirmation email says to contact the committee", async () => {
    const { id, email } = await register({ membership: "Tidak" });
    expect((await confirmPayment(db, id, "admin@x.nl", hours(1))).ok).toBe(true);
    const reg = (await getRegistration(db, id))!;
    expect(selfEditState(reg, event, hours(2))).toEqual({ editable: false, reason: "paid" });
    const edit = { ...(await currentInput(id)), registrantName: "Sesudah Bayar" };
    expect(await updateOwnRegistration(db, event, email, "", edit, { now: hours(2) })).toMatchObject({
      ok: false,
      reason: "locked",
    });

    expect((await deliverEmail(db, cfg, id, "confirmation", { now: hours(1) })).ok).toBe(true);
    const mail = (await lastMail(id))!;
    expect(mail.subject).toMatch(/^Konfirmasi/);
    expect(mail.html).toContain("tidak dapat lagi diubah sendiri");
    expect(mail.html).toContain(`mailto:${cfg.replyTo}`);
    expect(mail.html).not.toContain("telah diperbarui");
  });

  it("an edit after the participants were read makes a concurrent payment confirmation a no-op", async () => {
    const { id, email } = await register({ membership: "Tidak" });
    // Simulate: admin page loaded (rev = null), registrant edits, admin confirms with the stale view.
    const edit = await currentInput(id);
    edit.participants.push({ name: "Anak", gender: "laki-laki", ageGroup: "anak" });
    expect((await updateOwnRegistration(db, event, email, "", edit, { now: T0 })).ok).toBe(true);
    // confirmPayment re-reads, so it succeeds consistently with the new participants
    expect((await confirmPayment(db, id, "admin@x.nl", hours(1))).ok).toBe(true);
    const parts = await getParticipants(db, id);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.status === "accepted" && p.qr_token)).toBe(true);
  });

  it("past the payment deadline: locked", async () => {
    const { id, email } = await register({ membership: "Tidak" });
    const reg = (await getRegistration(db, id))!;
    const late = new Date(new Date(reg.pay_deadline!).getTime() + 1000);
    expect(selfEditState(reg, event, late)).toEqual({ editable: false, reason: "deadline" });
    const edit = { ...(await currentInput(id)), registrantName: "Telat" };
    expect(await updateOwnRegistration(db, event, email, "", edit, { now: late })).toMatchObject({ ok: false, reason: "locked" });
  });
});
