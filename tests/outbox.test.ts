import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { dashboardStats, listRegistrations } from "../app/lib/admin.server";
import { getParticipants, type EventRow } from "../app/lib/db.server";
import { MAX_EMAIL_ATTEMPTS, deliverEmail } from "../app/lib/email/send.server";
import { QR_BUDGET_PER_RUN, expireDue, runDeadlineJob } from "../app/lib/jobs.server";
import { confirmPayment } from "../app/lib/payments.server";
import { setMembershipVerified } from "../app/lib/payments.server";
import { registerOnline } from "../app/lib/registration.server";
import { T0, decodeQrPng, emailCfg, hours, input, resetDb, startDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;
let event: EventRow;

beforeAll(async () => ({ db, dispose } = await startDb()));
afterAll(async () => dispose?.());
beforeEach(async () => {
  event = await resetDb(db);
});

const opts = (now = T0) => ({ now, ignoreWindow: true });
const minutes = (m: number) => new Date(T0.getTime() + m * 60_000);
const sentMails = async () =>
  (await db.prepare("SELECT kind, to_address, attachments_json FROM dev_outbox ORDER BY id").all<{ kind: string; to_address: string; attachments_json: string }>()).results;
const logRow = (id: string, kind: string) =>
  db.prepare("SELECT status, attempts, sent_at FROM email_log WHERE registration_id = ? AND kind = ?").bind(id, kind).first<{ status: string; attempts: number; sent_at: string | null }>();

/** A member who registered and is waiting for validation (no QR code yet). */
async function waitingMember(people = 1) {
  const r = await registerOnline(db, event, input({ people }), opts());
  if (r.kind !== "pending_membership") throw new Error(r.kind);
  return r.registrationId;
}
/** A member who registered and was validated by an admin: accepted, ticket codes issued, QR email queued. */
async function member(people = 1) {
  const id = await waitingMember(people);
  expect((await setMembershipVerified(db, id, "admin@x.nl", true, opts().now)).ok).toBe(true);
  return id;
}
async function nonMember(people = 1) {
  const r = await registerOnline(db, event, input({ membership: "Tidak", people }), opts());
  if (r.kind !== "pending_payment") throw new Error(r.kind);
  return r.registrationId;
}

describe("the email is recorded in the same transaction as the change", () => {
  it("member registration -> pending 'membership_pending' row only (no QR email yet), nothing sent", async () => {
    const id = await waitingMember();
    expect(await logRow(id, "membership_pending")).toMatchObject({ status: "pending", attempts: 0, sent_at: null });
    expect(await logRow(id, "confirmation")).toBeNull();
    expect(await sentMails()).toHaveLength(0);
  });

  it("validating a member records the pending QR 'confirmation' row in the same batch", async () => {
    const id = await waitingMember(2);
    expect(await logRow(id, "confirmation")).toBeNull();
    expect((await setMembershipVerified(db, id, "admin@x.nl", true, opts().now)).ok).toBe(true);
    expect(await logRow(id, "confirmation")).toMatchObject({ status: "pending", attempts: 0, sent_at: null });
  });

  it("a refused validation (rejected first) records no QR email", async () => {
    const id = await waitingMember();
    await db.prepare("UPDATE registrations SET status = 'rejected_membership' WHERE id = ?").bind(id).run();
    await db.prepare("UPDATE participants SET status = 'accepted' WHERE registration_id = ?").bind(id).run(); // wrong participant state
    expect((await setMembershipVerified(db, id, "admin@x.nl", true, opts().now)).ok).toBe(false);
    expect(await logRow(id, "confirmation")).toBeNull();
  });

  it("non-member registration -> pending 'payment_instructions' row", async () => {
    const id = await nonMember();
    expect(await logRow(id, "payment_instructions")).toMatchObject({ status: "pending", attempts: 0 });
    expect(await logRow(id, "confirmation")).toBeNull();
  });

  it("a quota rejection sends nothing and records no email", async () => {
    event = await resetDb(db, { member: 1 });
    await waitingMember();
    const r = await registerOnline(db, event, input({ people: 2 }), opts());
    expect(r.kind).toBe("rejected_quota");
    const n = await db.prepare("SELECT COUNT(*) AS n FROM email_log").first<{ n: number }>();
    expect(n!.n).toBe(1); // only the waiting member's notice
  });

  it("approving a payment records the pending QR email in the same batch", async () => {
    const id = await nonMember(2);
    expect((await confirmPayment(db, id, "admin@x.nl", hours(1))).ok).toBe(true);
    expect(await logRow(id, "confirmation")).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("a refused approval (after the deadline) records no email", async () => {
    const id = await nonMember();
    expect((await confirmPayment(db, id, "admin@x.nl", hours(7))).ok).toBe(false);
    expect(await logRow(id, "confirmation")).toBeNull();
  });

  it("expiring a registration records the pending 'expired' email in the same batch", async () => {
    const id = await nonMember();
    expect(await expireDue(db, hours(6.1))).toEqual([id]);
    expect(await logRow(id, "expired")).toMatchObject({ status: "pending", attempts: 0 });
    expect(await expireDue(db, hours(6.2))).toEqual([]); // already expired: not again
  });
});

describe("the lost-email scenario: the Worker is killed right after the data was saved", () => {
  it("registration: the cron sweeper sends the confirmation + QR that the request never sent", async () => {
    const id = await member(2);
    // (no deliverEmail call = the invocation died before sending)
    expect(await sentMails()).toHaveLength(0);

    const report = await runDeadlineJob(db, emailCfg, minutes(5));
    expect(report.retried).toBe(1);

    const mails = await sentMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ kind: "confirmation" });
    const all = JSON.parse(mails[0].attachments_json) as { contentBase64: string; contentId?: string; contentType: string }[];
    expect(all.filter((a) => a.contentType === "text/calendar; charset=utf-8")).toHaveLength(1); // the .ics
    const qrs = all.filter((a) => a.contentId); // inline QR images
    const tokens = (await getParticipants(db, id)).map((p) => p.qr_token);
    expect(qrs.map((q) => decodeQrPng(Uint8Array.from(Buffer.from(q.contentBase64, "base64"))))).toEqual(tokens);
    expect(await logRow(id, "confirmation")).toMatchObject({ status: "sent", attempts: 1 });

    expect((await runDeadlineJob(db, emailCfg, minutes(10))).retried).toBe(0); // and never twice
    expect(await sentMails()).toHaveLength(1);
  });

  it("validating many members never makes one run render every QR: the sweeper sends QR emails in batches", async () => {
    // 4 families of 4 = 16 QR codes, all validated at once (validation itself only writes rows)
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await member(4));
    expect(await sentMails()).toHaveLength(0);

    const run1 = await runDeadlineJob(db, emailCfg, minutes(5));
    expect(QR_BUDGET_PER_RUN).toBe(8);
    expect(run1).toMatchObject({ retried: 2, deferred: 2 }); // 2 x 4 QR = the budget of one run
    expect(await sentMails()).toHaveLength(2);

    const run2 = await runDeadlineJob(db, emailCfg, minutes(10));
    expect(run2).toMatchObject({ retried: 2, deferred: 0 });
    const mails = await sentMails();
    expect(mails).toHaveLength(4);
    expect(new Set(mails.map((m) => m.to_address)).size).toBe(4); // every family got exactly one
    for (const id of ids) expect(await logRow(id, "confirmation")).toMatchObject({ status: "sent" });
  });

  it("a single family larger than the budget is still sent (the first email of a run always goes)", async () => {
    const id = await member(8);
    await member(1);
    const run = await runDeadlineJob(db, emailCfg, minutes(5));
    expect(run).toMatchObject({ retried: 1, deferred: 1 });
    expect(await logRow(id, "confirmation")).toMatchObject({ status: "sent" });
  });

  it("rejecting a waiting member frees the seats and the stale notice is not sent", async () => {
    event = await resetDb(db, { member: 1 });
    const id = await waitingMember(1);
    expect((await registerOnline(db, event, input(), opts())).kind).toBe("rejected_quota"); // seat is held
    const { rejectMembership } = await import("../app/lib/payments.server");
    expect((await rejectMembership(db, id, "admin@x.nl", opts().now)).ok).toBe(true);
    expect((await registerOnline(db, event, input(), opts())).kind).toBe("pending_membership"); // seat is free again
    const run = await runDeadlineJob(db, emailCfg, minutes(5));
    expect(run.retried).toBe(1); // only the new member's notice; the rejected one's notice is skipped
    expect((await sentMails()).map((m) => m.kind)).toEqual(["membership_pending"]);
  });

  it("payment approval: the QR email still goes out", async () => {
    const id = await nonMember();
    await deliverEmail(db, emailCfg, id, "payment_instructions", { now: T0 });
    await confirmPayment(db, id, "admin@x.nl", hours(1));
    // approval request killed before sending the QR email
    await runDeadlineJob(db, emailCfg, new Date(hours(1).getTime() + 5 * 60_000));
    expect((await sentMails()).map((m) => m.kind)).toEqual(["payment_instructions", "confirmation"]);
  });

  it("expiry: the notice is sent even if the job died between marking expired and sending", async () => {
    const id = await nonMember();
    await deliverEmail(db, emailCfg, id, "payment_instructions", { now: T0 });
    await expireDue(db, hours(6.1)); // marked expired + outbox row, then "killed"
    await runDeadlineJob(db, emailCfg, hours(6.2));
    expect((await sentMails()).map((m) => m.kind)).toEqual(["payment_instructions", "expired"]);
    expect(await logRow(id, "expired")).toMatchObject({ status: "sent" });
  });
});

describe("claiming: no duplicates, no endless retries", () => {
  it("two senders at the same moment send exactly one email", async () => {
    const id = await member();
    const results = await Promise.all([
      deliverEmail(db, emailCfg, id, "confirmation", { now: T0 }),
      deliverEmail(db, emailCfg, id, "confirmation", { now: T0 }),
      deliverEmail(db, emailCfg, id, "confirmation", { now: T0 }),
    ]);
    expect(results.filter((r) => !r.skipped)).toHaveLength(1);
    expect(await sentMails()).toHaveLength(1);
  });

  it("an already sent email is skipped, but the admin 'resend' (force) sends it again", async () => {
    const id = await member();
    await deliverEmail(db, emailCfg, id, "confirmation", { now: T0 });
    expect(await deliverEmail(db, emailCfg, id, "confirmation", { now: minutes(10) })).toMatchObject({ skipped: true });
    expect((await deliverEmail(db, emailCfg, id, "confirmation", { now: minutes(11), force: true })).skipped).toBeUndefined();
    expect(await sentMails()).toHaveLength(2);
    expect(await logRow(id, "confirmation")).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("a claim holds a 60 s lease: the sweeper leaves a recently claimed row alone, then takes over", async () => {
    const id = await member();
    // a sender claimed the row at T0 and died (status pending, attempts 1)
    await db.prepare("UPDATE email_log SET attempts = 1, updated_at = ? WHERE registration_id = ?").bind(T0.toISOString(), id).run();
    expect((await runDeadlineJob(db, emailCfg, new Date(T0.getTime() + 30_000))).retried).toBe(0);
    expect(await sentMails()).toHaveLength(0);
    expect((await runDeadlineJob(db, emailCfg, new Date(T0.getTime() + 61_000))).retried).toBe(1);
    expect(await logRow(id, "confirmation")).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("a send that keeps killing the Worker stops after the attempt limit instead of retrying forever", async () => {
    const id = await member();
    await db.prepare("UPDATE email_log SET attempts = ?, updated_at = ? WHERE registration_id = ?").bind(MAX_EMAIL_ATTEMPTS, T0.toISOString(), id).run();
    expect((await runDeadlineJob(db, emailCfg, minutes(30))).retried).toBe(0);
    expect(await sentMails()).toHaveLength(0);
    expect(await logRow(id, "confirmation")).toMatchObject({ status: "pending", attempts: MAX_EMAIL_ATTEMPTS });
  });

  it("each attempt is counted before the work starts (failure path: 1, then 2)", async () => {
    const id = await member();
    const broken = { ...emailCfg, mode: "resend" as const, resendApiKey: undefined };
    expect((await deliverEmail(db, broken, id, "confirmation", { now: T0 })).ok).toBe(false);
    expect(await logRow(id, "confirmation")).toMatchObject({ status: "failed", attempts: 1 });
    expect((await deliverEmail(db, broken, id, "confirmation", { now: minutes(2) })).ok).toBe(false);
    expect(await logRow(id, "confirmation")).toMatchObject({ status: "failed", attempts: 2 });
    // mail provider fixed: the sweeper delivers it
    await runDeadlineJob(db, emailCfg, minutes(5));
    expect(await logRow(id, "confirmation")).toMatchObject({ status: "sent", attempts: 3 });
  });
});

describe("admin visibility of stuck emails", () => {
  it("counts an unsent email only after the 5-minute grace period, and clears once sent", async () => {
    await member();
    const count = async (now: Date) => (await dashboardStats(db, event, now)).unsentEmails;
    expect(await count(minutes(2))).toBe(0);
    expect(await count(minutes(6))).toBe(1);
    await runDeadlineJob(db, emailCfg, minutes(6));
    expect(await count(minutes(7))).toBe(0);
  });

  it("also catches an accepted registration that has no email record at all (older data)", async () => {
    const id = await member();
    await db.prepare("DELETE FROM email_log WHERE registration_id = ?").bind(id).run();
    expect((await dashboardStats(db, event, minutes(10))).unsentEmails).toBe(1);
  });

  it("ignores manual registrations and rejected ones", async () => {
    event = await resetDb(db, { member: 1 });
    await member();
    await registerOnline(db, event, input({ people: 2 }), opts()); // rejected (quota)
    await db
      .prepare(
        `INSERT INTO registrations (id, event_id, created_at, registrant_name, is_member, email, people, source, status, payment_status)
         VALUES ('manual-1', ?, ?, 'Manual', 1, 'm@x.nl', 1, 'manual', 'accepted', 'manual')`,
      )
      .bind(event.id, T0.toISOString())
      .run();
    await db.prepare("DELETE FROM email_log").run();
    expect((await dashboardStats(db, event, minutes(10))).unsentEmails).toBe(1); // only the accepted online member
  });

  it("the registrations list can be filtered to unsent emails", async () => {
    const stuck = await member();
    const fine = await member();
    await deliverEmail(db, emailCfg, fine, "confirmation", { now: T0 });
    const list = await listRegistrations(db, event, { email: "unsent" }, minutes(10));
    expect(list.rows.map((r) => r.id)).toEqual([stuck]);
    expect((await listRegistrations(db, event, {}, minutes(10))).total).toBe(2);
  });
});
