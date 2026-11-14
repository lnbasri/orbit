import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listRegistrations } from "../app/lib/admin.server";
import { getParticipants, getRegistration, type EventRow } from "../app/lib/db.server";
import { deliverEmail, type Attachment } from "../app/lib/email/send.server";
import { TICKET_TOKEN_PATTERN } from "../app/lib/ids";
import { runDeadlineJob } from "../app/lib/jobs.server";
import { confirmPayment, deleteRegistration, rejectMembership, setMembershipVerified } from "../app/lib/payments.server";
import { quotaSummary, registerOnline } from "../app/lib/registration.server";
import { registrationSchema } from "../app/lib/validation";
import { T0, decodeQrPng, emailCfg, hours, input, resetDb, startDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;
let event: EventRow;

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  event = await resetDb(db);
});

const opts = (now = T0) => ({ now, ignoreWindow: true });

describe("member registration: validate first, then the QR code", () => {
  it("waits for validation: seats are held, but there are no ticket codes yet", async () => {
    const res = await registerOnline(db, event, input({ people: 3 }), opts());
    expect(res.kind).toBe("pending_membership");
    if (res.kind !== "pending_membership") return;

    const reg = await getRegistration(db, res.registrationId);
    expect(reg).toMatchObject({ status: "pending_membership", payment_status: "free", amount_cents: 0, payment_code: null, seats: 3 });
    const people = await getParticipants(db, res.registrationId);
    expect(people).toHaveLength(3);
    expect(people.every((p) => p.status === "pending_membership" && p.qr_token === null)).toBe(true);
    // only the "waiting for validation" notice is queued, never the QR confirmation
    const kinds = await db
      .prepare("SELECT kind FROM email_log WHERE registration_id = ?")
      .bind(res.registrationId)
      .all<{ kind: string }>();
    expect(kinds.results.map((r) => r.kind)).toEqual(["membership_pending"]);
    expect((await quotaSummary(db, event, T0)).member.used).toBe(3);
  });

  it("the notice email carries no QR code and says the QR follows validation", async () => {
    const res = await registerOnline(db, event, input({ people: 2 }), opts());
    if (res.kind !== "pending_membership") throw new Error(res.kind);
    expect((await deliverEmail(db, emailCfg, res.registrationId, "membership_pending")).ok).toBe(true);
    const mail = await db
      .prepare("SELECT html, attachments_json FROM dev_outbox WHERE registration_id = ?")
      .bind(res.registrationId)
      .first<{ html: string; attachments_json: string }>();
    expect(JSON.parse(mail!.attachments_json)).toHaveLength(0);
    expect(mail!.html).toContain("menunggu validasi keanggotaan");
    expect(mail!.html).not.toContain("cid:");
    // the QR email itself cannot be built while the membership is not validated
    const early = await deliverEmail(db, emailCfg, res.registrationId, "confirmation");
    expect(early.ok).toBe(false);
  });

  it("validation accepts the family, issues opaque ticket codes and queues the QR email in the same batch", async () => {
    const res = await registerOnline(db, event, input({ people: 3 }), opts());
    if (res.kind !== "pending_membership") throw new Error(res.kind);
    const v = await setMembershipVerified(db, res.registrationId, "admin@test", true, hours(1));
    expect(v).toMatchObject({ ok: true, activated: true });

    expect(await getRegistration(db, res.registrationId)).toMatchObject({
      status: "accepted",
      payment_status: "free",
      membership_verified_by: "admin@test",
    });
    const people = await getParticipants(db, res.registrationId);
    for (const p of people) {
      expect(p.status).toBe("accepted");
      expect(p.qr_token).toMatch(TICKET_TOKEN_PATTERN);
      expect(p.qr_token).not.toContain(p.id.slice(0, 8).toUpperCase()); // unrelated to any id or personal field
    }
    const log = await db
      .prepare("SELECT status FROM email_log WHERE registration_id = ? AND kind = 'confirmation'")
      .bind(res.registrationId)
      .first<{ status: string }>();
    expect(log?.status).toBe("pending");
    // validating twice is refused (the registration is no longer waiting)
    const again = await setMembershipVerified(db, res.registrationId, "admin@test", true, hours(2));
    expect(again.activated).toBeUndefined();
  });

  it("confirmation email embeds one QR per participant, the calendar links and an .ics attachment", async () => {
    const res = await registerOnline(db, event, input({ people: 2 }), opts());
    if (res.kind !== "pending_membership") throw new Error(res.kind);
    await setMembershipVerified(db, res.registrationId, "admin@test", true, hours(1));
    expect((await deliverEmail(db, emailCfg, res.registrationId, "confirmation")).ok).toBe(true);

    const mail = await db
      .prepare("SELECT subject, html, attachments_json FROM dev_outbox WHERE registration_id = ?")
      .bind(res.registrationId)
      .first<{ subject: string; html: string; attachments_json: string }>();
    // a first confirmation after validation is not presented as an "update of the registration"
    expect(mail!.subject).toMatch(/^Konfirmasi Pendaftaran/);
    expect(mail!.html).not.toContain("telah diperbarui");
    const all = JSON.parse(mail!.attachments_json) as Attachment[];
    const attachments = all.filter((a) => a.contentId);
    const tokens = (await getParticipants(db, res.registrationId)).map((p) => p.qr_token);

    expect(attachments).toHaveLength(2);
    attachments.forEach((a, i) => {
      expect(mail!.html).toContain(`cid:${a.contentId}`);
      expect(decodeQrPng(Uint8Array.from(Buffer.from(a.contentBase64, "base64")))).toBe(tokens[i]);
    });
    // The fixed template no longer contains the duplicated list item (B9).
    expect(mail!.html.replace(/href="[^"]*"/g, "").match(/Penyelenggara/g)).toHaveLength(1);
    expect(mail!.html).toContain("Keanggotaan Anda telah divalidasi");
    expect(mail!.html).toContain("calendar.google.com/calendar/render");
    expect(mail!.html).toContain("outlook.live.com/calendar/0/deeplink/compose");
    expect(mail!.html).toContain("25 Jumadil Akhir 1448"); // Hijri date of the event day
    const ics = all.find((a) => a.contentType.startsWith("text/calendar"));
    expect(ics).toBeTruthy();
    expect(ics!.contentId).toBeUndefined();
    const text = Buffer.from(ics!.contentBase64, "base64").toString("utf8");
    expect(text).toContain("BEGIN:VEVENT");
    expect(text).toContain("DTSTART:20261205T080000Z");
    expect(text).toContain("DTEND:20261205T133000Z");
  });
});

describe("non-member registration and payment", () => {
  it("waits for payment with a sequential code, €5 per person and a 6 h deadline", async () => {
    const a = await registerOnline(db, event, input({ membership: "Tidak", people: 2 }), opts());
    const b = await registerOnline(db, event, input({ membership: "Tidak" }), opts());
    expect(a).toMatchObject({ kind: "pending_payment", paymentCode: "PPME-2026-000001", amountCents: 1000 });
    expect(b).toMatchObject({ kind: "pending_payment", paymentCode: "PPME-2026-000002", amountCents: 500 });
    if (a.kind !== "pending_payment") return;
    expect(a.payDeadline).toBe(hours(6).toISOString());
    const people = await getParticipants(db, a.registrationId);
    expect(people.every((p) => p.status === "pending_payment" && p.qr_token === null)).toBe(true);
  });

  it("only remaja and dewasa pay; balita and anak are free but still take a seat", async () => {
    const base = input({ membership: "Tidak", people: 4 });
    base.participants.forEach((p, i) => (p.ageGroup = ["dewasa", "remaja", "anak", "balita"][i]));
    const r = await registerOnline(db, event, base, opts());
    expect(r).toMatchObject({ kind: "pending_payment", amountCents: 1000 });
    expect(await getParticipants(db, (r as { registrationId: string }).registrationId)).toHaveLength(4);
  });

  it("the registrant (participant 1) must be dewasa, for members and non-members", () => {
    for (const membership of ["Ya", "Tidak"] as const) {
      for (const ageGroup of ["balita", "anak", "remaja"] as const) {
        const i = input({ membership, people: 2 });
        i.participants[0].ageGroup = ageGroup;
        const r = registrationSchema(8).safeParse(i);
        expect(r.success).toBe(false);
        expect(r.error!.issues[0].path).toEqual(["participants", 0, "ageGroup"]);
      }
    }
    expect(registrationSchema(8).safeParse(input({ people: 2 })).success).toBe(true);
  });

  it("admin confirmation accepts the family and issues ticket codes; a second confirmation is refused", async () => {
    const a = await registerOnline(db, event, input({ membership: "Tidak", people: 2 }), opts());
    if (a.kind !== "pending_payment") throw new Error(a.kind);

    const ok = await confirmPayment(db, a.registrationId, "admin@test", hours(1));
    expect(ok.ok).toBe(true);
    expect(await getRegistration(db, a.registrationId)).toMatchObject({
      status: "accepted",
      payment_status: "paid",
      confirmed_by: "admin@test",
    });
    const people = await getParticipants(db, a.registrationId);
    expect(people.every((p) => p.status === "accepted" && TICKET_TOKEN_PATTERN.test(p.qr_token ?? ""))).toBe(true);

    expect((await confirmPayment(db, a.registrationId, "admin@test", hours(2))).ok).toBe(false);
  });

  it("refuses confirmation after the deadline", async () => {
    const a = await registerOnline(db, event, input({ membership: "Tidak" }), opts());
    if (a.kind !== "pending_payment") throw new Error(a.kind);
    const res = await confirmPayment(db, a.registrationId, "admin@test", hours(6.01));
    expect(res).toMatchObject({ ok: false });
    expect((await getRegistration(db, a.registrationId))!.status).toBe("pending_payment");
  });
});

describe("quota", () => {
  it("rejects the whole family when seats are short and records the rejection", async () => {
    event = await resetDb(db, { member: 3 });
    expect((await registerOnline(db, event, input({ people: 2 }), opts())).kind).toBe("pending_membership");
    const res = await registerOnline(db, event, input({ people: 2 }), opts());
    expect(res).toMatchObject({ kind: "rejected_quota", remaining: 1, people: 2, seats: 2 });
    if (res.kind !== "rejected_quota") return;
    expect((await getRegistration(db, res.registrationId))!.status).toBe("rejected_quota");
    expect((await getParticipants(db, res.registrationId)).every((p) => p.status === "rejected")).toBe(true);
    expect((await registerOnline(db, event, input({ people: 1 }), opts())).kind).toBe("pending_membership");
  });

  it("member and non-member quotas are independent", async () => {
    event = await resetDb(db, { member: 1, nonMember: 1 });
    expect((await registerOnline(db, event, input(), opts())).kind).toBe("pending_membership");
    expect((await registerOnline(db, event, input({ membership: "Tidak" }), opts())).kind).toBe("pending_payment");
    expect((await registerOnline(db, event, input(), opts())).kind).toBe("rejected_quota");
  });

  it("pending payments hold seats until their deadline, then free them even before the cron runs", async () => {
    event = await resetDb(db, { nonMember: 2 });
    expect((await registerOnline(db, event, input({ membership: "Tidak", people: 2 }), opts())).kind).toBe(
      "pending_payment",
    );
    expect((await registerOnline(db, event, input({ membership: "Tidak" }), opts(hours(5)))).kind).toBe(
      "rejected_quota",
    );
    expect((await registerOnline(db, event, input({ membership: "Tidak", people: 2 }), opts(hours(6.5)))).kind).toBe(
      "pending_payment",
    );
  });

  it("manual registrations do not use quota", async () => {
    event = await resetDb(db, { member: 2 });
    await db
      .prepare(
        `INSERT INTO registrations (id, event_id, created_at, registrant_name, is_member, people, source, status, payment_status)
         VALUES ('manual-1', ?, ?, 'Manual', 1, 5, 'manual', 'accepted', 'manual')`,
      )
      .bind(event.id, T0.toISOString())
      .run();
    expect((await registerOnline(db, event, input({ people: 2 }), opts())).kind).toBe("pending_membership");
  });

  it("concurrent submissions never oversell the last seats", async () => {
    event = await resetDb(db, { member: 3 });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => registerOnline(db, event, input({ people: 2 }), opts())),
    );
    expect(results.filter((r) => r.kind === "pending_membership")).toHaveLength(1);
    const used = await db
      .prepare("SELECT SUM(seats) AS n FROM registrations WHERE status = 'pending_membership'")
      .first<{ n: number }>();
    expect(used!.n).toBeLessThanOrEqual(3);
  });
});

describe("email is the registration key (B5)", () => {
  it("refuses a second active registration for the same email, case-insensitively", async () => {
    expect((await registerOnline(db, event, input({ email: "keluarga@example.com" }), opts())).kind).toBe("pending_membership");
    expect((await registerOnline(db, event, input({ email: "Keluarga@Example.com".toLowerCase() }), opts())).kind).toBe(
      "duplicate_email",
    );
    const counter = await db.prepare("SELECT payment_counter FROM events").first<{ payment_counter: number }>();
    expect(counter!.payment_counter).toBe(0);
  });

  it("allows registering again after an expired attempt", async () => {
    const email = "ulang@example.com";
    expect((await registerOnline(db, event, input({ email, membership: "Tidak" }), opts())).kind).toBe(
      "pending_payment",
    );
    await runDeadlineJob(db, emailCfg, hours(7));
    expect((await registerOnline(db, event, input({ email, membership: "Tidak" }), opts(hours(7)))).kind).toBe(
      "pending_payment",
    );
  });

  it("a replayed submit (same idempotency key) returns the original registration", async () => {
    const key = crypto.randomUUID();
    const first = await registerOnline(db, event, input({ idempotencyKey: key, email: "dobel@example.com" }), opts());
    const again = await registerOnline(db, event, input({ idempotencyKey: key, email: "dobel@example.com" }), opts());
    expect(again).toEqual(first);
  });
});

describe("deadline job", () => {
  it("sends one reminder after 5 h, then expires at 6 h with one expiry email", async () => {
    const a = await registerOnline(db, event, input({ membership: "Tidak" }), opts());
    if (a.kind !== "pending_payment") throw new Error(a.kind);
    await deliverEmail(db, emailCfg, a.registrationId, "payment_instructions");

    expect(await runDeadlineJob(db, emailCfg, hours(4))).toEqual({ expired: 0, reminders: 0, retried: 0, deferred: 0 });
    expect((await runDeadlineJob(db, emailCfg, hours(5.1))).reminders).toBe(1);
    expect((await runDeadlineJob(db, emailCfg, hours(5.5))).reminders).toBe(0);
    expect((await runDeadlineJob(db, emailCfg, hours(6.1))).expired).toBe(1);
    expect((await runDeadlineJob(db, emailCfg, hours(6.5))).expired).toBe(0);

    expect(await getRegistration(db, a.registrationId)).toMatchObject({ status: "expired", payment_status: "expired" });
    const kinds = await db
      .prepare("SELECT kind FROM dev_outbox WHERE registration_id = ? ORDER BY id")
      .bind(a.registrationId)
      .all<{ kind: string }>();
    expect(kinds.results.map((r) => r.kind)).toEqual(["payment_instructions", "reminder", "expired"]);
  });
});

describe("membership verification (N6)", () => {
  it("records who verified a member registration", async () => {
    const a = await registerOnline(db, event, input(), opts());
    if (a.kind !== "pending_membership") throw new Error(a.kind);
    expect((await setMembershipVerified(db, a.registrationId, "admin@test", true, hours(1))).ok).toBe(true);
    expect(await getRegistration(db, a.registrationId)).toMatchObject({ membership_verified_by: "admin@test" });
  });

  it("reject: invalidates tickets, frees the email and quota, and cannot hit a verified member", async () => {
    const a = await registerOnline(db, event, input({ people: 2, email: "same-a@example.com" }), opts());
    if (a.kind !== "pending_membership") throw new Error(a.kind);
    expect((await rejectMembership(db, a.registrationId, "admin@test", hours(1))).ok).toBe(true);
    expect(await getRegistration(db, a.registrationId)).toMatchObject({ status: "rejected_membership", payment_status: "not_processed" });
    const people = await getParticipants(db, a.registrationId);
    expect(people.every((p) => p.status === "rejected" && p.qr_token === null)).toBe(true);
    const audit = await db.prepare("SELECT action FROM audit_log WHERE target = ?").bind(a.registrationId).all<{ action: string }>();
    expect(audit.results.map((r) => r.action)).toContain("membership.reject");
    // second reject is a no-op, and the same email may register again
    expect((await rejectMembership(db, a.registrationId, "admin@test", hours(2))).ok).toBe(false);
    expect((await registerOnline(db, event, input({ people: 1, email: "same-a@example.com" }), opts(hours(3)))).kind).toBe("pending_membership");

    const b = await registerOnline(db, event, input({ email: "other@example.com" }), opts());
    if (b.kind !== "pending_membership") throw new Error(b.kind);
    await setMembershipVerified(db, b.registrationId, "admin@test", true, hours(1));
    expect((await rejectMembership(db, b.registrationId, "admin@test", hours(2))).ok).toBe(false);
  });
});

describe("revive and delete", () => {
  it("verifying a rejected member re-activates it with fresh QR codes and a re-queued confirmation", async () => {
    const a = await registerOnline(db, event, input({ people: 2 }), opts());
    if (a.kind !== "pending_membership") throw new Error(a.kind);
    const before = (await getParticipants(db, a.registrationId)).map((p) => p.qr_token);
    await rejectMembership(db, a.registrationId, "admin@test", hours(1));
    const res = await setMembershipVerified(db, a.registrationId, "admin@test", true, hours(2));
    expect(res).toMatchObject({ ok: true, activated: true });
    expect(await getRegistration(db, a.registrationId)).toMatchObject({
      status: "accepted",
      payment_status: "free",
      membership_verified_by: "admin@test",
    });
    const people = await getParticipants(db, a.registrationId);
    expect(people.every((p) => p.status === "accepted" && p.qr_token && !before.includes(p.qr_token))).toBe(true);
    const log = await db
      .prepare("SELECT status FROM email_log WHERE registration_id = ? AND kind = 'confirmation'")
      .bind(a.registrationId)
      .first<{ status: string }>();
    expect(log?.status).toBe("pending");
  });

  it("does not revive while another active registration uses the same email", async () => {
    const a = await registerOnline(db, event, input({ email: "same-b@example.com" }), opts());
    if (a.kind !== "pending_membership") throw new Error(a.kind);
    await rejectMembership(db, a.registrationId, "admin@test", hours(1));
    expect((await registerOnline(db, event, input({ email: "same-b@example.com" }), opts(hours(2)))).kind).toBe("pending_membership");
    const res = await setMembershipVerified(db, a.registrationId, "admin@test", true, hours(3));
    expect(res.ok).toBe(false);
    expect((await getRegistration(db, a.registrationId))?.status).toBe("rejected_membership");
  });

  it("delete removes the registration with its rows and writes the audit log; refused after check-in", async () => {
    const a = await registerOnline(db, event, input({ people: 2 }), opts());
    if (a.kind !== "pending_membership") throw new Error(a.kind);
    expect((await deleteRegistration(db, a.registrationId, "admin@test", hours(1))).ok).toBe(true);
    expect(await getRegistration(db, a.registrationId)).toBeNull();
    expect(await getParticipants(db, a.registrationId)).toHaveLength(0);
    const audit = await db
      .prepare("SELECT action, detail FROM audit_log WHERE target = ? AND action = 'registration.delete'")
      .bind(a.registrationId)
      .first<{ action: string; detail: string }>();
    expect(audit?.detail).toContain("people");
    expect((await deleteRegistration(db, a.registrationId, "admin@test", hours(2))).ok).toBe(false);

    const b = await registerOnline(db, event, input({ email: "b@example.com" }), opts());
    if (b.kind !== "pending_membership") throw new Error(b.kind);
    await db.prepare("UPDATE participants SET checked_in_at = ? WHERE registration_id = ?").bind(hours(1).toISOString(), b.registrationId).run();
    expect((await deleteRegistration(db, b.registrationId, "admin@test", hours(2))).ok).toBe(false);
    expect(await getRegistration(db, b.registrationId)).not.toBeNull();
  });
});

describe("admin work queue (status = actionable)", () => {
  it("lists pending payments first, then unvalidated members, oldest first; hides processed and expired", async () => {
    const m1 = await registerOnline(db, event, input({ registrantName: "Member Satu" }), opts(T0));
    const n1 = await registerOnline(db, event, input({ registrantName: "Bayar Satu", membership: "Tidak" }), opts(hours(1)));
    const m2 = await registerOnline(db, event, input({ registrantName: "Member Dua" }), opts(hours(2)));
    const n2 = await registerOnline(db, event, input({ registrantName: "Bayar Dua", membership: "Tidak" }), opts(hours(3)));
    const m3 = await registerOnline(db, event, input({ registrantName: "Member Verified" }), opts(hours(4)));
    const n3 = await registerOnline(db, event, input({ registrantName: "Sudah Lunas", membership: "Tidak" }), opts(hours(5)));
    for (const r of [m1, n1, m2, n2, m3, n3]) if (r.kind !== "pending_membership" && r.kind !== "pending_payment") throw new Error(r.kind);
    const id = (r: unknown) => (r as { registrationId: string }).registrationId;
    await setMembershipVerified(db, id(m3), "admin@test", true, hours(6));
    await confirmPayment(db, id(n3), "admin@test", hours(6));

    const now = hours(6); // all pending ones are still inside their 6 h deadline
    const queue = await listRegistrations(db, event, { status: "actionable" }, now);
    expect(queue.rows.map((r) => r.registrant_name)).toEqual(["Bayar Satu", "Bayar Dua", "Member Satu", "Member Dua"]);
    expect(queue.total).toBe(4);
    // "" = everything, newest first
    const all = await listRegistrations(db, event, {}, now);
    expect(all.total).toBe(6);
    expect(all.rows[0].registrant_name).toBe("Sudah Lunas");

    // past the pay deadline the pending ones drop out of the queue (they are expired), members stay
    const late = await listRegistrations(db, event, { status: "actionable" }, hours(24 * 30));
    expect(late.rows.map((r) => r.registrant_name)).toEqual(["Member Satu", "Member Dua"]);
  });
});
