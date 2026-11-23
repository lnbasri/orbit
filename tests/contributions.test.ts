import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createContribution,
  getContributionSummary,
  listContributionPayments,
  listContributions,
  recordContributionPayment,
  voidContribution,
  voidContributionPayment,
} from "../app/lib/contributions.server";
import {
  getCurrencyInfo,
  parseMoneyToMinorUnits,
} from "../app/lib/money";
import { resetDb, startDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => resetDb(db));

const now = new Date("2026-11-20T10:00:00.000Z");
const timestamp = now.toISOString();

async function addMember(id = "member-1") {
  await db.prepare(
    `INSERT INTO members (id, full_name, gender, status, created_at, updated_at)
     VALUES (?, ?, 'female', 'active', ?, ?)`,
  ).bind(id, "Test Member", timestamp, timestamp).run();
}

async function addHousehold(id = "household-1") {
  await db.prepare(
    "INSERT INTO households (id, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  ).bind(id, "Test Household", timestamp, timestamp).run();
}

async function createRecord(amount = "100.00", dueOn = "2026-11-19") {
  const result = await createContribution(db, "admin@example.com", {
    targetType: "member",
    targetId: "member-1",
    recordType: "contribution",
    title: "Annual dues",
    reference: "DUES-2026",
    amount,
    currencyCode: "EUR",
    dueOn,
    notes: "",
  }, now);
  if (!result.ok) throw new Error(result.message);
  return result.id;
}

describe("contribution ledger", () => {
  beforeEach(async () => {
    await addMember();
    await addHousehold();
  });

  it("uses exact minor units and honors currencies with zero decimal places", () => {
    expect(getCurrencyInfo("eur")).toEqual({ code: "EUR", exponent: 2 });
    expect(parseMoneyToMinorUnits("10.50", 2)).toBe(1050);
    expect(parseMoneyToMinorUnits("10.005", 2)).toBeNull();
    expect(getCurrencyInfo("JPY")).toEqual({ code: "JPY", exponent: 0 });
    expect(parseMoneyToMinorUnits("125", 0)).toBe(125);
    expect(parseMoneyToMinorUnits("125.00", 0)).toBeNull();
  });

  it("tracks partial payments, prevents overpayment, and updates overdue reporting", async () => {
    const contributionId = await createRecord();
    const partial = await recordContributionPayment(db, "admin@example.com", {
      contributionId,
      amount: "25.00",
      paidOn: "2026-11-20",
      method: "bank_transfer",
      reference: "",
      notes: "",
    }, now);
    expect(partial.ok).toBe(true);

    const excess = await recordContributionPayment(db, "admin@example.com", {
      contributionId,
      amount: "80.00",
      paidOn: "2026-11-20",
      method: "cash",
      reference: "",
      notes: "",
    }, now);
    expect(excess).toEqual({ ok: false, message: "Payment cannot exceed the outstanding balance." });

    const overdue = await listContributions(db, { q: "", status: "overdue", page: 1 }, now);
    expect(overdue.count).toBe(1);
    expect(overdue.records[0]).toMatchObject({
      id: contributionId,
      status: "overdue",
      amount_minor: 10_000,
      paid_minor: 2_500,
      balance_minor: 7_500,
      member_name: "Test Member",
    });

    const summary = await getContributionSummary(db, now);
    expect(summary).toMatchObject({ outstandingCount: 1, overdueCount: 1, paidCount: 0 });
    expect(summary.currencies).toEqual([expect.objectContaining({
      currency_code: "EUR",
      outstanding_minor: 7_500,
      overdue_minor: 7_500,
      collected_minor: 2_500,
    })]);

    const remainder = await recordContributionPayment(db, "admin@example.com", {
      contributionId,
      amount: "75.00",
      paidOn: "2026-11-20",
      method: "bank_transfer",
      reference: "",
      notes: "",
    }, now);
    expect(remainder.ok).toBe(true);
    const paid = await listContributions(db, { q: "", status: "paid", page: 1 }, now);
    expect(paid.records[0]).toMatchObject({ status: "paid", paid_minor: 10_000, balance_minor: 0 });
  });

  it("keeps voided payments in history and excludes them from balances", async () => {
    const contributionId = await createRecord("40.00", "");
    const firstPayment = await recordContributionPayment(db, "admin@example.com", {
      contributionId,
      amount: "10.00",
      paidOn: "2026-11-20",
      method: "cash",
      reference: "",
      notes: "",
    }, now);
    if (!firstPayment.ok) throw new Error(firstPayment.message);

    await expect(db.prepare(
      "UPDATE contributions SET voided_at = ?, voided_by = 'admin@example.com' WHERE id = ?",
    ).bind(timestamp, contributionId).run()).rejects.toThrow("Contribution has active payments");
    const cannotVoid = await voidContribution(db, "admin@example.com", contributionId, "entered in error", now);
    expect(cannotVoid.ok).toBe(false);
    const voidFirst = await voidContributionPayment(db, "admin@example.com", firstPayment.id, "Wrong amount", now);
    expect(voidFirst.ok).toBe(true);

    const replacement = await recordContributionPayment(db, "admin@example.com", {
      contributionId,
      amount: "40.00",
      paidOn: "2026-11-20",
      method: "bank_transfer",
      reference: "corrected",
      notes: "",
    }, now);
    if (!replacement.ok) throw new Error(replacement.message);

    const voidReplacement = await voidContributionPayment(db, "admin@example.com", replacement.id, "Duplicate entry", now);
    expect(voidReplacement.ok).toBe(true);
    const voidRecord = await voidContribution(db, "admin@example.com", contributionId, "Record created in error", now);
    expect(voidRecord.ok).toBe(true);

    const records = await listContributions(db, { q: "", status: "voided", page: 1 }, now);
    expect(records.records[0]).toMatchObject({ id: contributionId, status: "voided", paid_minor: 0 });
    const payments = await listContributionPayments(db, [contributionId]);
    expect(payments).toHaveLength(2);
    expect(payments.every((payment) => payment.voided_at !== null)).toBe(true);
    const auditActions = await db.prepare(
      "SELECT action FROM audit_log WHERE target IN (?, ?, ?) ORDER BY id",
    ).bind(contributionId, firstPayment.id, replacement.id).all<{ action: string }>();
    expect(auditActions.results.map((entry) => entry.action)).toEqual([
      "contribution.created",
      "contribution.payment.recorded",
      "contribution.payment.voided",
      "contribution.payment.recorded",
      "contribution.payment.voided",
      "contribution.voided",
    ]);
    expect((await getContributionSummary(db, now))).toMatchObject({
      activeCount: 0,
      outstandingCount: 0,
      overdueCount: 0,
      paidCount: 0,
    });
  });

  it("supports household records and keeps the database overpayment guard", async () => {
    const householdRecord = await createContribution(db, "admin@example.com", {
      targetType: "household",
      targetId: "household-1",
      recordType: "invoice",
      title: "Hall rental",
      reference: "",
      amount: "5",
      currencyCode: "JPY",
      dueOn: "",
      notes: "",
    }, now);
    if (!householdRecord.ok) throw new Error(householdRecord.message);

    await db.prepare(
      `INSERT INTO contribution_payments
       (id, contribution_id, amount_minor, paid_on, method, recorded_by, created_at)
       VALUES ('payment-one', ?, 4, '2026-11-20', 'cash', 'admin@example.com', ?)`,
    ).bind(householdRecord.id, timestamp).run();
    await expect(db.prepare(
      `INSERT INTO contribution_payments
       (id, contribution_id, amount_minor, paid_on, method, recorded_by, created_at)
       VALUES ('payment-two', ?, 2, '2026-11-20', 'cash', 'admin@example.com', ?)`,
    ).bind(householdRecord.id, timestamp).run()).rejects.toThrow("Payment exceeds outstanding balance");

    const invoice = await listContributions(db, { q: "Hall rental", status: "", page: 1 }, now);
    expect(invoice.records[0]).toMatchObject({
      record_type: "invoice",
      household_name: "Test Household",
      currency_code: "JPY",
      minor_unit_exponent: 0,
      balance_minor: 1,
    });
  });
});
