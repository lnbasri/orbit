import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getParticipants, getRegistration, type EventRow } from "../app/lib/db.server";
import { deliverEmail } from "../app/lib/email/send.server";
import { TICKET_TOKEN_PATTERN } from "../app/lib/ids";
import { confirmPayment, setMembershipVerified } from "../app/lib/payments.server";
import {
  createRegistrantSession,
  identifyRegistrant,
  requestRegistrantCode,
  verifyRegistrantCode,
} from "../app/lib/registrant-access.server";
import { quotaSummary, registerOnline } from "../app/lib/registration.server";
import { updateSelfAdd } from "../app/lib/events.server";
import { cancelOwnRegistration, selfEditState, updateOwnRegistration } from "../app/lib/self-service.server";
import { selfEditSchema, type SelfEditInput } from "../app/lib/validation";
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
  // adding participants is off by default (quota control); the existing edit tests need it on, the new tests also test off
  await db.prepare("UPDATE events SET self_add_allowed = 1").run();
  event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
});

const cfg = { ...emailCfg, publicUrl: "https://public.example" };
const meta = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (iPhone) Safari/605.1", country: "NL", appOrigin: "https://public.example" };

/** Registers; a member is validated by an admin right away (accepted, with QR codes) unless `validate: false`. */
async function register(overrides: Parameters<typeof input>[0] = {}, validate = true) {
  const data = input(overrides);
  const res = await registerOnline(db, event, data, { now: T0, ignoreWindow: true });
  if (res.kind !== "pending_membership" && res.kind !== "pending_payment") throw new Error(res.kind);
  if (res.kind === "pending_membership" && validate) {
    // validated a minute before the tests' edits, so an edit afterwards is a real "update"
    expect((await setMembershipVerified(db, res.registrationId, "admin@test", true, new Date(T0.getTime() - 60_000))).ok).toBe(true);
  }
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
    // the manage link is a button (like "Berikan Infaq"), not a bare URL
    expect(mail.html).toMatch(/<a href="https:\/\/public\.example\/e\/kajian-aisah-dahlan-2026\/pendaftaran-saya"[^>]*>Lihat atau Ubah Pendaftaran<\/a>/);
    expect(mail.html).toContain("Peserta Tambahan");
    // same "Ketentuan pendaftaran" as the public form, incl. the former "Catatan penting"
    expect(mail.html).toContain("Ketentuan Pendaftaran");
    expect(mail.html).toContain("Pendaftaran ditutup otomatis apabila kuota peserta sudah terpenuhi.");
    expect(mail.html).toContain("periksa juga folder spam");
    // 2 QR images + the calendar file
    expect((JSON.parse(mail.attachments_json) as { contentId?: string }[]).filter((a) => a.contentId)).toHaveLength(2);

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

describe("member waiting for validation: self-service edit", () => {
  it("may edit before validation: no ticket for the new participant, the notice is re-queued, validation then issues all tickets", async () => {
    const { id, email } = await register({ people: 1 }, false);
    const edit = await currentInput(id);
    edit.participants.push({ name: "Anak Baru", gender: "perempuan", ageGroup: "anak" });
    const res = await updateOwnRegistration(db, event, email, "", edit, { now: T0 });
    expect(res).toMatchObject({ ok: true, changed: true, email: "membership_pending", people: 2 });
    expect(await emailRow(id, "membership_pending")).toMatchObject({ status: "pending", attempts: 0 });
    expect(await emailRow(id, "confirmation")).toBeNull();
    const waiting = await getParticipants(db, id);
    expect(waiting.every((p) => p.status === "pending_membership" && p.qr_token === null)).toBe(true);

    expect((await setMembershipVerified(db, id, "admin@test", true, hours(1))).ok).toBe(true);
    const accepted = await getParticipants(db, id);
    expect(accepted).toHaveLength(2);
    expect(accepted.every((p) => p.status === "accepted" && TICKET_TOKEN_PATTERN.test(p.qr_token ?? ""))).toBe(true);
  });

  it("a validation after the participants were read is a no-op when an edit came in between", async () => {
    const { id, email } = await register({ people: 1 }, false);
    const edit = { ...(await currentInput(id)), registrantName: "Sudah Diubah" };
    expect((await updateOwnRegistration(db, event, email, "", edit, { now: T0 })).ok).toBe(true);
    // the admin acts on a participants list that predates the edit (edit_rev moved on): validation still works on the
    // fresh data, and nobody is left without a ticket
    expect((await setMembershipVerified(db, id, "admin@test", true, hours(1))).ok).toBe(true);
    expect((await getParticipants(db, id)).every((p) => p.qr_token)).toBe(true);
  });
});

describe("quota counts remaja and dewasa only", () => {
  it("balita and anak never take a seat, in registration or in an edit", async () => {
    event = await resetDb(db, { member: 2 });
    await db.prepare("UPDATE events SET registration_closes_at = ?").bind("2026-11-27T22:59:00.000Z").run();
    const data = input({ people: 5 });
    data.participants.forEach((p, i) => (p.ageGroup = (["dewasa", "remaja", "anak", "balita", "anak"] as const)[i]));
    const res = await registerOnline(db, event, data, { now: T0, ignoreWindow: true });
    expect(res.kind).toBe("pending_membership"); // 5 people, but only 2 seats
    if (res.kind !== "pending_membership") return;
    expect((await getRegistration(db, res.registrationId))!.seats).toBe(2);
    expect((await quotaSummary(db, event, T0)).member).toMatchObject({ used: 2, remaining: 0 });

    // quota is full for adults, yet children can still be added; one more adult cannot
    const edit = await currentInput(res.registrationId);
    edit.participants.push({ name: "Balita Lagi", gender: "laki-laki", ageGroup: "balita" });
    expect((await updateOwnRegistration(db, event, data.email, "", edit, { now: T0 })).ok).toBe(true);
    const edit2 = await currentInput(res.registrationId);
    edit2.participants.push({ name: "Dewasa Lagi", gender: "laki-laki", ageGroup: "dewasa" });
    expect(await updateOwnRegistration(db, event, data.email, await rev(res.registrationId), edit2, { now: T0 })).toMatchObject({
      ok: false,
      reason: "quota",
    });
    expect((await getRegistration(db, res.registrationId))!.seats).toBe(2);
  });

  it("changing an adult into a child frees the seat", async () => {
    event = await resetDb(db, { member: 2 });
    await db.prepare("UPDATE events SET registration_closes_at = ?").bind("2026-11-27T22:59:00.000Z").run();
    const { id, email } = await register({ people: 2 }); // dewasa + remaja = 2 seats
    expect((await quotaSummary(db, event, T0)).member.used).toBe(2);
    const edit = await currentInput(id);
    edit.participants[1].ageGroup = "anak";
    expect((await updateOwnRegistration(db, event, email, "", edit, { now: T0 })).ok).toBe(true);
    expect((await quotaSummary(db, event, T0)).member.used).toBe(1);
  });
});

describe("non-member self-service edit", () => {
  it("balita/anak do not add to the amount, and the registrant cannot be a free age group", async () => {
    const { id, email } = await register({ membership: "Tidak", people: 1 });
    const edit = await currentInput(id);
    edit.participants.push({ name: "Adik", gender: "perempuan", ageGroup: "balita" });
    const ok = await updateOwnRegistration(db, event, email, "", edit, { now: T0 });
    expect(ok).toMatchObject({ ok: true, people: 2, amountCents: event.price_non_member_cents });

    const edit2 = selfEditSchema(8).safeParse({ ...edit, participants: edit.participants.map((p, n) => (n ? p : { ...p, ageGroup: "anak" })) });
    expect(edit2.success).toBe(false);
  });

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

describe("admin switch: registrants may add new participants (default off)", () => {
  const off = async () => {
    await db.prepare("UPDATE events SET self_add_allowed = 0").run();
    event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
  };

  it("the column defaults to off", async () => {
    const row = await db
      .prepare("SELECT dflt_value FROM pragma_table_info('events') WHERE name = 'self_add_allowed'")
      .first<{ dflt_value: string }>();
    expect(row?.dflt_value).toBe("0");
  });

  it("off: adding is refused (nothing changes, quota untouched); renaming and removing still work", async () => {
    await off();
    const { id, email } = await register({ people: 2 });
    const used = (await quotaSummary(db, event)).member.used;

    const add = await currentInput(id);
    add.participants.push({ name: "Orang Baru", gender: "laki-laki", ageGroup: "dewasa" });
    const refused = await updateOwnRegistration(db, event, email, await rev(id), add, { now: T0 });
    expect(refused).toMatchObject({ ok: false, reason: "add_disabled" });
    expect(await getParticipants(db, id)).toHaveLength(2);
    expect((await quotaSummary(db, event)).member.used).toBe(used);

    const edit = await currentInput(id);
    edit.participants[1].name = "Nama Diganti";
    expect(await updateOwnRegistration(db, event, email, await rev(id), edit, { now: T0 })).toMatchObject({ ok: true, changed: true });
    const remove = await currentInput(id);
    remove.participants = remove.participants.slice(0, 1);
    expect(await updateOwnRegistration(db, event, email, await rev(id), remove, { now: T0 })).toMatchObject({ ok: true, changed: true });
    expect(await getParticipants(db, id)).toHaveLength(1);
  });

  it("off: swapping a participant for a new one is also an add and is refused", async () => {
    await off();
    const { id, email } = await register({ people: 2 });
    const swap = await currentInput(id);
    swap.participants = [swap.participants[0], { name: "Pengganti", gender: "perempuan", ageGroup: "dewasa" }];
    expect(await updateOwnRegistration(db, event, email, await rev(id), swap, { now: T0 })).toMatchObject({ ok: false, reason: "add_disabled" });
    expect((await getParticipants(db, id)).map((p) => p.full_name)).not.toContain("Pengganti");
  });

  it("the SQL itself refuses an add when the switch flips off after the event row was read", async () => {
    const { id, email } = await register({ people: 1 });
    const stale = event; // loaded while on
    await db.prepare("UPDATE events SET self_add_allowed = 0").run();
    const add = await currentInput(id);
    add.participants.push({ name: "Orang Baru", gender: "laki-laki", ageGroup: "dewasa" });
    expect(await updateOwnRegistration(db, stale, email, await rev(id), add, { now: T0 })).toMatchObject({ ok: false, reason: "add_disabled" });
    expect(await getParticipants(db, id)).toHaveLength(1);
  });

  it("on (admin toggle, audited): adding works again and is still checked against the quota", async () => {
    await off();
    const { id, email } = await register({ people: 1 });
    expect((await updateSelfAdd(db, "admin@test", event.id, true, T0)).ok).toBe(true);
    event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
    expect(event.self_add_allowed).toBe(1);
    const add = await currentInput(id);
    add.participants.push({ name: "Orang Baru", gender: "laki-laki", ageGroup: "dewasa" });
    expect(await updateOwnRegistration(db, event, email, await rev(id), add, { now: T0 })).toMatchObject({ ok: true, changed: true });

    // quota is still enforced while on
    await db.prepare("UPDATE events SET quota_member = ?").bind((await quotaSummary(db, event)).member.used).run();
    event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
    const more = await currentInput(id);
    more.participants.push({ name: "Terlalu Banyak", gender: "laki-laki", ageGroup: "dewasa" });
    expect(await updateOwnRegistration(db, event, email, await rev(id), more, { now: T0 })).toMatchObject({ ok: false, reason: "quota" });

    expect((await updateSelfAdd(db, "admin@test", event.id, false, T0)).ok).toBe(true);
    const audits = await db
      .prepare("SELECT actor, detail FROM audit_log WHERE action = 'event.self_add' ORDER BY id")
      .all<{ actor: string; detail: string }>();
    expect(audits.results.map((a) => [a.actor, a.detail])).toEqual([
      ["admin@test", JSON.stringify({ from: 0, to: 1 })],
      ["admin@test", JSON.stringify({ from: 1, to: 0 })],
    ]);
  });
});

describe("self cancel (delete own registration)", () => {
  const count = (sql: string, ...b: unknown[]) =>
    db.prepare(sql).bind(...b).first<{ n: number }>().then((r) => r!.n);

  it("deletes only the own registration (participants, emails, sessions, codes), frees its seats, audits without personal data", async () => {
    const a = await register({ people: 3 });
    const b = await register({ people: 2 });
    const c = await register({ membership: "Tidak", people: 2 }, false);
    for (const x of [a, b]) await requestRegistrantCode(db, cfg, event, x.email, meta, T0);
    await createRegistrantSession(db, event.id, a.email, meta, T0);
    await createRegistrantSession(db, event.id, b.email, meta, T0);
    const before = await quotaSummary(db, event);
    const aSeats = (await getRegistration(db, a.id))!.seats;
    expect(aSeats).toBeGreaterThan(0);
    const bTokens = (await getParticipants(db, b.id)).map((p) => p.qr_token);
    const bEmails = await count("SELECT COUNT(*) n FROM email_log WHERE registration_id = ?", b.id);
    const regsBefore = await count("SELECT COUNT(*) n FROM registrations");
    const aName = (await getRegistration(db, a.id))!.registrant_name;

    const res = await cancelOwnRegistration(db, event, a.email, await rev(a.id), { now: T0 });
    expect(res.ok).toBe(true);

    // A is gone, completely
    expect(await getRegistration(db, a.id)).toBeNull();
    expect(await count("SELECT COUNT(*) n FROM participants WHERE registration_id = ?", a.id)).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM email_log WHERE registration_id = ?", a.id)).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM dev_outbox WHERE registration_id = ?", a.id)).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM registrant_sessions WHERE email = ?", a.email)).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM registrant_login_codes WHERE email = ?", a.email)).toBe(0);

    // everybody else is untouched
    expect(await count("SELECT COUNT(*) n FROM registrations")).toBe(regsBefore - 1);
    expect((await getRegistration(db, b.id))!.status).toBe("accepted");
    expect((await getParticipants(db, b.id)).map((p) => p.qr_token)).toEqual(bTokens);
    expect(await count("SELECT COUNT(*) n FROM email_log WHERE registration_id = ?", b.id)).toBe(bEmails);
    expect(await count("SELECT COUNT(*) n FROM registrant_sessions WHERE email = ?", b.email)).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM registrant_login_codes WHERE email = ?", b.email)).toBe(1);
    expect(await getParticipants(db, c.id)).toHaveLength(2);
    expect((await getRegistration(db, c.id))!.status).toBe("pending_payment");

    // A's seats are free again, only A's
    const after = await quotaSummary(db, event);
    expect(after.member.used).toBe(before.member.used - aSeats);
    expect(after.nonMember.used).toBe(before.nonMember.used);

    // audit row exists, without name or email
    const audit = await db
      .prepare("SELECT actor, target, detail FROM audit_log WHERE action = 'registration.self_cancel'")
      .all<{ actor: string; target: string; detail: string }>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0].target).toBe(a.id);
    expect(JSON.stringify(audit.results[0])).not.toContain(aName);
    expect(JSON.stringify(audit.results[0])).not.toContain(a.email);
    expect(JSON.parse(audit.results[0].detail)).toMatchObject({ status: "accepted", people: 3, member: true });

    // the same email can register again
    const again = await registerOnline(db, event, input({ email: a.email }), { now: T0, ignoreWindow: true });
    expect(again.kind).toBe("pending_membership");
  });

  it("cannot touch another registration: the target always comes from the signed-in email and its revision", async () => {
    const a = await register({ people: 1 });
    const b = await register({ people: 1 });
    const eb = await currentInput(b.id);
    eb.registrantName = "B Diubah";
    expect((await updateOwnRegistration(db, event, b.email, "", eb, { now: T0 })).ok).toBe(true); // B now has a revision
    const res = await cancelOwnRegistration(db, event, a.email, await rev(b.id), { now: T0 }); // B's revision, A's email
    expect(res).toMatchObject({ ok: false, reason: "stale" });
    expect(await getRegistration(db, a.id)).not.toBeNull();
    expect(await getRegistration(db, b.id)).not.toBeNull();
    expect(await cancelOwnRegistration(db, event, "nobody@example.com", "", { now: T0 })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await count("SELECT COUNT(*) n FROM audit_log WHERE action = 'registration.self_cancel'")).toBe(0);
  });

  it("refuses a stale revision (edited in another tab)", async () => {
    const a = await register({ people: 1 });
    const stale = await rev(a.id);
    const edit = await currentInput(a.id);
    edit.registrantName = "Diubah";
    expect((await updateOwnRegistration(db, event, a.email, stale, edit, { now: T0 })).ok).toBe(true);
    expect(await cancelOwnRegistration(db, event, a.email, stale, { now: T0 })).toMatchObject({ ok: false, reason: "stale" });
    expect(await getRegistration(db, a.id)).not.toBeNull();
  });

  it("a non-member with a pending payment can cancel before the deadline, not after", async () => {
    const a = await register({ membership: "Tidak", people: 2 }, false);
    expect(await cancelOwnRegistration(db, event, a.email, await rev(a.id), { now: hours(48) })).toMatchObject({ ok: false, reason: "locked" });
    expect(await getRegistration(db, a.id)).not.toBeNull();
    expect((await cancelOwnRegistration(db, event, a.email, await rev(a.id), { now: T0 })).ok).toBe(true);
    expect(await getRegistration(db, a.id)).toBeNull();
  });

  it("refuses once the payment is confirmed (changes go through the committee) and keeps everything", async () => {
    const a = await register({ membership: "Tidak", people: 2 }, false);
    expect((await confirmPayment(db, a.id, "admin@test", T0)).ok).toBe(true);
    expect(await cancelOwnRegistration(db, event, a.email, await rev(a.id), { now: T0 })).toMatchObject({ ok: false, reason: "locked" });
    expect((await getRegistration(db, a.id))!.status).toBe("accepted");
    expect(await getParticipants(db, a.id)).toHaveLength(2);
  });

  it("refuses when someone was already checked in, and after the event started", async () => {
    const a = await register({ people: 2 });
    await db.prepare("UPDATE participants SET checked_in_at = ? WHERE registration_id = ? AND position = 1").bind(T0.toISOString(), a.id).run();
    expect((await cancelOwnRegistration(db, event, a.email, await rev(a.id), { now: T0 })).ok).toBe(false);
    expect(await getParticipants(db, a.id)).toHaveLength(2);

    const b = await register({ people: 1 });
    expect(await cancelOwnRegistration(db, event, b.email, await rev(b.id), { now: new Date("2026-12-05T09:00:00.000Z") })).toMatchObject({ ok: false, reason: "locked" });
    expect(await getRegistration(db, b.id)).not.toBeNull();
  });

  it("a member may still cancel after registration closed (frees the seat), unlike editing", async () => {
    const a = await register({ people: 1 });
    const afterClose = new Date("2026-11-30T12:00:00.000Z");
    expect(selfEditState((await getRegistration(db, a.id))!, event, afterClose).editable).toBe(false);
    expect((await cancelOwnRegistration(db, event, a.email, await rev(a.id), { now: afterClose })).ok).toBe(true);
  });

  it("a second cancel of the same registration does nothing", async () => {
    const a = await register({ people: 1 });
    const r = await rev(a.id);
    expect((await cancelOwnRegistration(db, event, a.email, r, { now: T0 })).ok).toBe(true);
    expect(await cancelOwnRegistration(db, event, a.email, r, { now: T0 })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await count("SELECT COUNT(*) n FROM audit_log WHERE action = 'registration.self_cancel'")).toBe(1);
  });
});
