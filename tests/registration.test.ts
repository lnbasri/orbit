import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getParticipants, getRegistration, type EventRow } from "../app/lib/db.server";
import { deliverEmail, type Attachment } from "../app/lib/email/send.server";
import { TICKET_TOKEN_PATTERN } from "../app/lib/ids";
import { runDeadlineJob } from "../app/lib/jobs.server";
import { confirmPayment, setMembershipVerified } from "../app/lib/payments.server";
import { registerOnline } from "../app/lib/registration.server";
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

describe("member registration", () => {
  it("is accepted for free and every participant gets an opaque ticket code", async () => {
    const res = await registerOnline(db, event, input({ people: 3 }), opts());
    expect(res.kind).toBe("accepted");
    if (res.kind !== "accepted") return;

    const reg = await getRegistration(db, res.registrationId);
    expect(reg).toMatchObject({ status: "accepted", payment_status: "free", amount_cents: 0, payment_code: null });
    const people = await getParticipants(db, res.registrationId);
    expect(people).toHaveLength(3);
    for (const p of people) {
      expect(p.status).toBe("accepted");
      expect(p.qr_token).toMatch(TICKET_TOKEN_PATTERN);
      // The ticket code is unrelated to any id or personal field.
      expect(p.qr_token).not.toContain(p.id.slice(0, 8).toUpperCase());
    }
  });

  it("confirmation email embeds one QR per participant that decodes to that participant's code", async () => {
    const res = await registerOnline(db, event, input({ people: 2 }), opts());
    if (res.kind !== "accepted") throw new Error(res.kind);
    expect((await deliverEmail(db, emailCfg, res.registrationId, "confirmation")).ok).toBe(true);

    const mail = await db
      .prepare("SELECT html, attachments_json FROM dev_outbox WHERE registration_id = ?")
      .bind(res.registrationId)
      .first<{ html: string; attachments_json: string }>();
    const attachments = JSON.parse(mail!.attachments_json) as Attachment[];
    const tokens = (await getParticipants(db, res.registrationId)).map((p) => p.qr_token);

    expect(attachments).toHaveLength(2);
    attachments.forEach((a, i) => {
      expect(mail!.html).toContain(`cid:${a.contentId}`);
      expect(decodeQrPng(Uint8Array.from(Buffer.from(a.contentBase64, "base64")))).toBe(tokens[i]);
    });
    // The fixed template no longer contains the duplicated list item (B9).
    expect(mail!.html.match(/Penyelenggara/g)).toHaveLength(1);
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
    expect((await registerOnline(db, event, input({ people: 2 }), opts())).kind).toBe("accepted");
    const res = await registerOnline(db, event, input({ people: 2 }), opts());
    expect(res).toMatchObject({ kind: "rejected_quota", remaining: 1, people: 2 });
    if (res.kind !== "rejected_quota") return;
    expect((await getRegistration(db, res.registrationId))!.status).toBe("rejected_quota");
    expect((await getParticipants(db, res.registrationId)).every((p) => p.status === "rejected")).toBe(true);
    expect((await registerOnline(db, event, input({ people: 1 }), opts())).kind).toBe("accepted");
  });

  it("member and non-member quotas are independent", async () => {
    event = await resetDb(db, { member: 1, nonMember: 1 });
    expect((await registerOnline(db, event, input(), opts())).kind).toBe("accepted");
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
    expect((await registerOnline(db, event, input({ people: 2 }), opts())).kind).toBe("accepted");
  });

  it("concurrent submissions never oversell the last seats", async () => {
    event = await resetDb(db, { member: 3 });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => registerOnline(db, event, input({ people: 2 }), opts())),
    );
    expect(results.filter((r) => r.kind === "accepted")).toHaveLength(1);
    const used = await db
      .prepare("SELECT SUM(people) AS n FROM registrations WHERE status = 'accepted'")
      .first<{ n: number }>();
    expect(used!.n).toBeLessThanOrEqual(3);
  });
});

describe("email is the registration key (B5)", () => {
  it("refuses a second active registration for the same email, case-insensitively", async () => {
    expect((await registerOnline(db, event, input({ email: "keluarga@example.com" }), opts())).kind).toBe("accepted");
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

    expect(await runDeadlineJob(db, emailCfg, hours(4))).toEqual({ expired: 0, reminders: 0, retried: 0 });
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
    if (a.kind !== "accepted") throw new Error(a.kind);
    expect((await setMembershipVerified(db, a.registrationId, "admin@test", true, hours(1))).ok).toBe(true);
    expect(await getRegistration(db, a.registrationId)).toMatchObject({ membership_verified_by: "admin@test" });
  });
});
