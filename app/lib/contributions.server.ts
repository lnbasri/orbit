import { auditStatement } from "./db.server";
import {
  getCurrencyInfo,
  isIsoDate,
  parseMoneyToMinorUnits,
} from "./money";
import { CONTRIBUTION_PAGE_SIZE } from "./contribution-constants";

const CONTRIBUTION_STATUSES = ["open", "partial", "overdue", "paid", "voided"] as const;
const PAYMENT_METHODS = ["bank_transfer", "cash", "card", "other"] as const;

export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];
export type ContributionPaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface ContributionRow {
  id: string;
  member_id: string | null;
  household_id: string | null;
  member_name: string | null;
  household_name: string | null;
  record_type: "contribution" | "invoice";
  title: string;
  reference: string | null;
  amount_minor: number;
  paid_minor: number;
  balance_minor: number;
  currency_code: string;
  minor_unit_exponent: number;
  due_on: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  status: ContributionStatus;
}

export interface ContributionPaymentRow {
  id: string;
  contribution_id: string;
  amount_minor: number;
  paid_on: string;
  method: ContributionPaymentMethod;
  reference: string | null;
  notes: string | null;
  recorded_by: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

function contributionTotalsCte() {
  return `WITH totals AS (
    SELECT c.*,
           COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN p.amount_minor ELSE 0 END), 0) AS paid_minor
    FROM contributions c
    LEFT JOIN contribution_payments p ON p.contribution_id = c.id
    GROUP BY c.id
  ),
  classified AS (
    SELECT totals.*,
           amount_minor - paid_minor AS balance_minor,
           CASE
             WHEN voided_at IS NOT NULL THEN 'voided'
             WHEN paid_minor >= amount_minor THEN 'paid'
             WHEN due_on IS NOT NULL AND due_on < ? THEN 'overdue'
             WHEN paid_minor > 0 THEN 'partial'
             ELSE 'open'
           END AS status
    FROM totals
  )`;
}

function validDueDate(value: string): boolean {
  return !value || isIsoDate(value);
}

export async function createContribution(
  db: D1Database,
  actor: string,
  input: {
    targetType: string;
    targetId: string;
    recordType: string;
    title: string;
    reference: string;
    amount: string;
    currencyCode: string;
    dueOn: string;
    notes: string;
  },
  now = new Date(),
) {
  const title = input.title.trim();
  const reference = input.reference.trim();
  const dueOn = input.dueOn.trim();
  const notes = input.notes.trim();
  const currency = getCurrencyInfo(input.currencyCode);
  const amountMinor = currency
    ? parseMoneyToMinorUnits(input.amount, currency.exponent)
    : null;
  if (!title || title.length > 120) {
    return { ok: false as const, message: "Enter a description up to 120 characters." };
  }
  if (input.recordType !== "contribution" && input.recordType !== "invoice") {
    return { ok: false as const, message: "Choose a contribution or invoice record." };
  }
  if (!currency) return { ok: false as const, message: "Enter a valid ISO currency code." };
  if (amountMinor === null) {
    return { ok: false as const, message: `Enter a positive amount using up to ${currency.exponent} decimal places.` };
  }
  if (!validDueDate(dueOn)) return { ok: false as const, message: "Enter a valid due date." };
  if (reference.length > 100 || notes.length > 2000) {
    return { ok: false as const, message: "Reference or notes exceed the allowed length." };
  }

  let memberId: string | null = null;
  let householdId: string | null = null;
  if (input.targetType === "member") {
    const member = await db
      .prepare("SELECT id FROM members WHERE id = ? AND archived_at IS NULL")
      .bind(input.targetId)
      .first<{ id: string }>();
    if (!member) return { ok: false as const, message: "Select a current member." };
    memberId = member.id;
  } else if (input.targetType === "household") {
    const household = await db
      .prepare("SELECT id FROM households WHERE id = ?")
      .bind(input.targetId)
      .first<{ id: string }>();
    if (!household) return { ok: false as const, message: "Select a household." };
    householdId = household.id;
  } else {
    return { ok: false as const, message: "Choose a member or household." };
  }

  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO contributions
         (id, member_id, household_id, record_type, title, reference, amount_minor,
          currency_code, minor_unit_exponent, due_on, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      memberId,
      householdId,
      input.recordType,
      title,
      reference || null,
      amountMinor,
      currency.code,
      currency.exponent,
      dueOn || null,
      notes || null,
      actor,
      timestamp,
      timestamp,
    ),
    auditStatement(db, actor, "contribution.created", id, {
      recordType: input.recordType,
      targetType: input.targetType,
      amountMinor,
      currencyCode: currency.code,
    }, timestamp),
  ]);
  return { ok: true as const, id, message: "Contribution record created." };
}

export async function recordContributionPayment(
  db: D1Database,
  actor: string,
  input: {
    contributionId: string;
    amount: string;
    paidOn: string;
    method: string;
    reference: string;
    notes: string;
  },
  now = new Date(),
) {
  const contribution = await db.prepare(
    `SELECT c.amount_minor, c.currency_code, c.minor_unit_exponent, c.voided_at,
            COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN p.amount_minor ELSE 0 END), 0) AS paid_minor
     FROM contributions c
     LEFT JOIN contribution_payments p ON p.contribution_id = c.id
     WHERE c.id = ?
     GROUP BY c.id`,
  ).bind(input.contributionId).first<{
    amount_minor: number;
    currency_code: string;
    minor_unit_exponent: number;
    voided_at: string | null;
    paid_minor: number;
  }>();
  if (!contribution) return { ok: false as const, message: "Contribution record not found." };
  if (contribution.voided_at) return { ok: false as const, message: "This contribution record is voided." };

  const amountMinor = parseMoneyToMinorUnits(input.amount, contribution.minor_unit_exponent);
  if (amountMinor === null) {
    return {
      ok: false as const,
      message: `Enter a positive amount using up to ${contribution.minor_unit_exponent} decimal places.`,
    };
  }
  if (!isIsoDate(input.paidOn) || input.paidOn > now.toISOString().slice(0, 10)) {
    return { ok: false as const, message: "Enter a valid payment date that is not in the future." };
  }
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) {
    return { ok: false as const, message: "Choose a valid payment method." };
  }
  const reference = input.reference.trim();
  const notes = input.notes.trim();
  if (reference.length > 100 || notes.length > 1000) {
    return { ok: false as const, message: "Reference or notes exceed the allowed length." };
  }
  const outstanding = contribution.amount_minor - contribution.paid_minor;
  if (outstanding <= 0) return { ok: false as const, message: "This contribution is already fully paid." };
  if (amountMinor > outstanding) {
    return { ok: false as const, message: "Payment cannot exceed the outstanding balance." };
  }

  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO contribution_payments
           (id, contribution_id, amount_minor, paid_on, method, reference, notes, recorded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        input.contributionId,
        amountMinor,
        input.paidOn,
        input.method,
        reference || null,
        notes || null,
        actor,
        timestamp,
      ),
      auditStatement(db, actor, "contribution.payment.recorded", id, {
        contributionId: input.contributionId,
        amountMinor,
        currencyCode: contribution.currency_code,
        method: input.method,
      }, timestamp),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Payment exceeds outstanding balance")) {
      return { ok: false as const, message: "Payment cannot exceed the outstanding balance." };
    }
    if (message.includes("Contribution is voided")) {
      return { ok: false as const, message: "This contribution record is voided." };
    }
    throw error;
  }
  return { ok: true as const, id, message: "Payment recorded." };
}

export async function voidContributionPayment(
  db: D1Database,
  actor: string,
  paymentId: string,
  reasonRaw: string,
  now = new Date(),
) {
  const reason = reasonRaw.trim();
  if (!reason || reason.length > 500) {
    return { ok: false as const, message: "Enter a void reason up to 500 characters." };
  }
  const payment = await db.prepare(
    "SELECT id, contribution_id, amount_minor, voided_at FROM contribution_payments WHERE id = ?",
  ).bind(paymentId).first<{
    id: string;
    contribution_id: string;
    amount_minor: number;
    voided_at: string | null;
  }>();
  if (!payment) return { ok: false as const, message: "Payment not found." };
  if (payment.voided_at) return { ok: false as const, message: "Payment is already voided." };

  const timestamp = now.toISOString();
  await db.batch([
    db.prepare(
      `UPDATE contribution_payments
       SET voided_at = ?, voided_by = ?, void_reason = ?
       WHERE id = ? AND voided_at IS NULL`,
    ).bind(timestamp, actor, reason, paymentId),
    auditStatement(db, actor, "contribution.payment.voided", paymentId, {
      contributionId: payment.contribution_id,
      amountMinor: payment.amount_minor,
      reason,
    }, timestamp),
  ]);
  return { ok: true as const, message: "Payment voided. Record a replacement payment if needed." };
}

export async function voidContribution(
  db: D1Database,
  actor: string,
  contributionId: string,
  reasonRaw: string,
  now = new Date(),
) {
  const reason = reasonRaw.trim();
  if (!reason || reason.length > 500) {
    return { ok: false as const, message: "Enter a void reason up to 500 characters." };
  }
  const contribution = await db.prepare(
    `SELECT c.id, c.voided_at,
            COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN p.amount_minor ELSE 0 END), 0) AS paid_minor
     FROM contributions c
     LEFT JOIN contribution_payments p ON p.contribution_id = c.id
     WHERE c.id = ?
     GROUP BY c.id`,
  ).bind(contributionId).first<{ id: string; voided_at: string | null; paid_minor: number }>();
  if (!contribution) return { ok: false as const, message: "Contribution record not found." };
  if (contribution.voided_at) return { ok: false as const, message: "Contribution record is already voided." };
  if (contribution.paid_minor > 0) {
    return { ok: false as const, message: "Void its payments first, then void the contribution record." };
  }

  const timestamp = now.toISOString();
  try {
    await db.batch([
      db.prepare(
        `UPDATE contributions SET voided_at = ?, voided_by = ?, void_reason = ?, updated_at = ?
         WHERE id = ? AND voided_at IS NULL`,
      ).bind(timestamp, actor, reason, timestamp, contributionId),
      auditStatement(db, actor, "contribution.voided", contributionId, { reason }, timestamp),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Contribution has active payments")) {
      return { ok: false as const, message: "Void its payments first, then void the contribution record." };
    }
    throw error;
  }
  return { ok: true as const, message: "Contribution record voided." };
}

export async function listContributions(
  db: D1Database,
  filters: { q: string; status: string; page: number },
  asOf = new Date(),
) {
  const conditions: string[] = [];
  const filterBinds: string[] = [];
  const q = filters.q.trim();
  if (q) {
    conditions.push(
      "(c.title LIKE ? OR c.reference LIKE ? OR m.full_name LIKE ? OR h.name LIKE ?)",
    );
    const like = `%${q}%`;
    filterBinds.push(like, like, like, like);
  }
  if ((CONTRIBUTION_STATUSES as readonly string[]).includes(filters.status)) {
    conditions.push("c.status = ?");
    filterBinds.push(filters.status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const cte = contributionTotalsCte();
  const date = asOf.toISOString().slice(0, 10);
  const joins = `FROM classified c
    LEFT JOIN members m ON m.id = c.member_id
    LEFT JOIN households h ON h.id = c.household_id`;
  const count = await db.prepare(`${cte} SELECT COUNT(*) AS count ${joins} ${where}`)
    .bind(date, ...filterBinds)
    .first<{ count: number }>();
  const total = count?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / CONTRIBUTION_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page), pageCount);
  const { results } = await db.prepare(
    `WITH totals AS (
       SELECT c.*,
              COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN p.amount_minor ELSE 0 END), 0) AS paid_minor
       FROM contributions c
       LEFT JOIN contribution_payments p ON p.contribution_id = c.id
       GROUP BY c.id
     ),
     classified AS (
       SELECT totals.*,
              amount_minor - paid_minor AS balance_minor,
              CASE
                WHEN voided_at IS NOT NULL THEN 'voided'
                WHEN paid_minor >= amount_minor THEN 'paid'
                WHEN due_on IS NOT NULL AND due_on < ? THEN 'overdue'
                WHEN paid_minor > 0 THEN 'partial'
                ELSE 'open'
              END AS status
       FROM totals
     )
     SELECT c.*, m.full_name AS member_name, h.name AS household_name,
            COUNT(*) OVER() AS total_count
     ${joins}
     ${where}
     ORDER BY CASE c.status
       WHEN 'overdue' THEN 0 WHEN 'open' THEN 1 WHEN 'partial' THEN 2
       WHEN 'paid' THEN 3 ELSE 4 END,
       c.due_on, c.created_at DESC, c.id
     LIMIT ? OFFSET ?`,
  ).bind(date, ...filterBinds, CONTRIBUTION_PAGE_SIZE, (page - 1) * CONTRIBUTION_PAGE_SIZE)
    .all<ContributionRow & { total_count: number }>();
  return {
    records: results.map(({ total_count: _totalCount, ...record }) => record),
    count: total,
    page,
    pageCount,
  };
}

export async function listContributionPayments(
  db: D1Database,
  contributionIds: string[],
): Promise<ContributionPaymentRow[]> {
  if (!contributionIds.length) return [];
  const placeholders = contributionIds.map(() => "?").join(", ");
  const { results } = await db.prepare(
    `SELECT id, contribution_id, amount_minor, paid_on, method, reference, notes,
            recorded_by, created_at, voided_at, voided_by, void_reason
     FROM contribution_payments
     WHERE contribution_id IN (${placeholders})
     ORDER BY paid_on DESC, created_at DESC`,
  ).bind(...contributionIds).all<ContributionPaymentRow>();
  return results;
}

export async function getContributionSummary(db: D1Database, asOf = new Date()) {
  const { results } = await db.prepare(
    `${contributionTotalsCte()}
     SELECT currency_code, minor_unit_exponent,
            SUM(CASE WHEN voided_at IS NULL THEN 1 ELSE 0 END) AS active_count,
            SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdue_count,
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
            SUM(CASE WHEN voided_at IS NULL AND balance_minor > 0 THEN 1 ELSE 0 END) AS outstanding_count,
            SUM(CASE WHEN voided_at IS NULL AND balance_minor > 0 THEN balance_minor ELSE 0 END) AS outstanding_minor,
            SUM(CASE WHEN status = 'overdue' THEN balance_minor ELSE 0 END) AS overdue_minor,
            SUM(CASE WHEN voided_at IS NULL THEN paid_minor ELSE 0 END) AS collected_minor
     FROM classified
     GROUP BY currency_code, minor_unit_exponent
     ORDER BY currency_code`,
  ).bind(asOf.toISOString().slice(0, 10)).all<{
    currency_code: string;
    minor_unit_exponent: number;
    active_count: number;
    overdue_count: number;
    paid_count: number;
    outstanding_count: number;
    outstanding_minor: number;
    overdue_minor: number;
    collected_minor: number;
  }>();
  return {
    currencies: results,
    activeCount: results.reduce((sum, row) => sum + row.active_count, 0),
    overdueCount: results.reduce((sum, row) => sum + row.overdue_count, 0),
    paidCount: results.reduce((sum, row) => sum + row.paid_count, 0),
    outstandingCount: results.reduce((sum, row) => sum + row.outstanding_count, 0),
  };
}
