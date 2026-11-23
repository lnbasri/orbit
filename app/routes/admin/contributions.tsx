import { Form, Link, data } from "react-router";
import { BanknotesIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";

import type { Route } from "./+types/contributions";
import { EmptyState, Notice, PageHeader, Panel } from "~/components/admin";
import { TextField } from "~/components/forms";
import { buttonClass } from "~/components/ui";
import { adminEmailContext } from "~/lib/admin-context";
import { CONTRIBUTION_PAGE_SIZE } from "~/lib/contribution-constants";
import {
  createContribution,
  getContributionSummary,
  listContributionPayments,
  listContributions,
  recordContributionPayment,
  voidContribution,
  voidContributionPayment,
  type ContributionPaymentMethod,
  type ContributionStatus,
} from "~/lib/contributions.server";
import { getAppEnv } from "~/lib/env.server";
import {
  DEFAULT_CURRENCY_CODE,
  formatMinorUnits,
  formatMinorUnitsInput,
} from "~/lib/money";

const STATUSES: ContributionStatus[] = ["open", "partial", "overdue", "paid", "voided"];
const STATUS_LABEL: Record<ContributionStatus, string> = {
  open: "Open",
  partial: "Partially paid",
  overdue: "Overdue",
  paid: "Paid",
  voided: "Voided",
};
const STATUS_STYLE: Record<ContributionStatus, string> = {
  open: "bg-slate-100 text-slate-700 ring-slate-500/20",
  partial: "bg-sky-50 text-sky-800 ring-sky-600/20",
  overdue: "bg-red-50 text-red-800 ring-red-600/20",
  paid: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  voided: "bg-slate-100 text-slate-500 ring-slate-500/20",
};
const METHOD_LABEL: Record<ContributionPaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  card: "Card",
  other: "Other",
};

export function meta() {
  return [{ title: "Contributions & Payments — ORBIT" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const env = getAppEnv();
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const requestedStatus = url.searchParams.get("status") ?? "";
  const status = STATUSES.includes(requestedStatus as ContributionStatus) ? requestedStatus : "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const asOf = new Date();
  const asOfDate = asOf.toISOString().slice(0, 10);
  const [contributionPage, summary, members, households] = await Promise.all([
    listContributions(env.DB, { q, status, page }, asOf),
    getContributionSummary(env.DB, asOf),
    env.DB.prepare(
      "SELECT id, full_name FROM members WHERE archived_at IS NULL AND status <> 'deceased' ORDER BY full_name COLLATE NOCASE",
    ).all<{ id: string; full_name: string }>(),
    env.DB.prepare("SELECT id, name FROM households WHERE status = 'active' ORDER BY name COLLATE NOCASE")
      .all<{ id: string; name: string }>(),
  ]);
  const paymentRows = await listContributionPayments(
    env.DB,
    contributionPage.records.map((record) => record.id),
  );
  const paymentsByContribution: Record<string, typeof paymentRows> = {};
  for (const payment of paymentRows) {
    (paymentsByContribution[payment.contribution_id] ??= []).push(payment);
  }
  return {
    ...contributionPage,
    q,
    status,
    summary,
    members: members.results,
    households: households.results,
    asOfDate,
    paymentsByContribution,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const env = getAppEnv();
  const actor = context.get(adminEmailContext);
  const intent = String(form.get("intent") ?? "");
  let result;

  if (intent === "create-contribution") {
    const target = String(form.get("target") ?? "");
    const separator = target.indexOf(":");
    result = await createContribution(env.DB, actor, {
      targetType: separator < 0 ? "" : target.slice(0, separator),
      targetId: separator < 0 ? "" : target.slice(separator + 1),
      recordType: String(form.get("recordType") ?? ""),
      title: String(form.get("title") ?? ""),
      reference: String(form.get("reference") ?? ""),
      amount: String(form.get("amount") ?? ""),
      currencyCode: String(form.get("currencyCode") ?? ""),
      dueOn: String(form.get("dueOn") ?? ""),
      notes: String(form.get("notes") ?? ""),
    });
  } else if (intent === "record-payment") {
    result = await recordContributionPayment(env.DB, actor, {
      contributionId: String(form.get("contributionId") ?? ""),
      amount: String(form.get("amount") ?? ""),
      paidOn: String(form.get("paidOn") ?? ""),
      method: String(form.get("method") ?? ""),
      reference: String(form.get("reference") ?? ""),
      notes: String(form.get("notes") ?? ""),
    });
  } else if (intent === "void-payment") {
    result = await voidContributionPayment(
      env.DB,
      actor,
      String(form.get("paymentId") ?? ""),
      String(form.get("reason") ?? ""),
    );
  } else if (intent === "void-contribution") {
    result = await voidContribution(
      env.DB,
      actor,
      String(form.get("contributionId") ?? ""),
      String(form.get("reason") ?? ""),
    );
  } else {
    return data({ ok: false, message: "Unknown action." }, { status: 400 });
  }

  return data(result, { status: result.ok ? 200 : 400 });
}

export default function Contributions({ loaderData, actionData }: Route.ComponentProps) {
  const {
    records,
    count,
    page,
    pageCount,
    q,
    status,
    summary,
    members,
    households,
    asOfDate,
    paymentsByContribution,
  } = loaderData;

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Contributions & payments"
        description="Track expected contributions and invoices, record partial payments, and follow up on balances."
      />
      <Notice result={actionData} className="mb-5" />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Open balances" count={summary.outstandingCount} amounts={summary.currencies.map((row) => ({
          code: row.currency_code,
          exponent: row.minor_unit_exponent,
          amount: row.outstanding_minor,
        }))} />
        <SummaryCard label="Overdue" count={summary.overdueCount} amounts={summary.currencies.map((row) => ({
          code: row.currency_code,
          exponent: row.minor_unit_exponent,
          amount: row.overdue_minor,
        }))} emphasis />
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-sm font-medium text-slate-500">Fully paid records</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{summary.paidCount}</p>
          <p className="mt-1 text-xs text-slate-500">Collected {summary.currencies.map((row) =>
            formatMinorUnits(row.collected_minor, row.currency_code, row.minor_unit_exponent),
          ).join(" · ") || "—"}</p>
        </div>
      </div>

      <Panel title="Add an expected contribution or invoice" icon={BanknotesIcon}>
        <Form method="post" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="intent" value="create-contribution" />
          <label className="text-sm font-medium text-slate-700">
            Member or household
            <select name="target" required className={selectClass}>
              <option value="">Select a recipient</option>
              <optgroup label="Members">
                {members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.full_name}</option>)}
              </optgroup>
              <optgroup label="Households">
                {households.map((household) => <option key={household.id} value={`household:${household.id}`}>{household.name}</option>)}
              </optgroup>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Record type
            <select name="recordType" defaultValue="contribution" className={selectClass}>
              <option value="contribution">Contribution</option>
              <option value="invoice">Invoice</option>
            </select>
          </label>
          <TextField name="title" label="Description" required maxLength={120} placeholder="e.g. Annual membership contribution" />
          <TextField name="amount" label="Expected amount" required inputMode="decimal" placeholder="0.00" />
          <TextField name="currencyCode" label="Currency code" required maxLength={3} defaultValue={DEFAULT_CURRENCY_CODE} />
          <TextField name="reference" label="Reference or invoice number" maxLength={100} />
          <TextField name="dueOn" label="Due date (optional)" type="date" />
          <TextField name="notes" label="Notes (optional)" maxLength={2000} />
          <div className="flex items-end">
            <button type="submit" className={buttonClass("primary", "md")} disabled={!members.length && !households.length}>
              Add record
            </button>
          </div>
        </Form>
        {!members.length && !households.length && (
          <p className="mt-3 text-sm text-amber-800">Add a current member or active household before creating a record.</p>
        )}
        <p className="mt-3 text-xs text-slate-500">Amounts are stored as exact minor units. EUR is the default; enter a valid three-letter ISO currency code when using another currency.</p>
      </Panel>

      <Panel title={<>Ledger <span className="text-slate-400 tabular-nums">({count})</span></>} icon={BanknotesIcon} className="mt-6" flush>
        <Form method="get" className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end sm:px-5">
          <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">
            Search records
            <span className="relative mt-1.5 block">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input name="q" type="search" defaultValue={q} placeholder="Description, reference, member, or household" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15" />
            </span>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Status
            <select name="status" defaultValue={status} className={`${selectClass} sm:w-48`}>
              <option value="">All statuses</option>
              {STATUSES.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
            </select>
          </label>
          <button type="submit" className={buttonClass("secondary", "md")}>Filter</button>
        </Form>

        {records.length ? (
          <>
            <ul className="divide-y divide-slate-100">
              {records.map((record) => {
                const payments = paymentsByContribution[record.id] ?? [];
                const hasActivePayments = payments.some((payment) => !payment.voided_at);
                return (
                  <li key={record.id} className="px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold text-slate-900">{record.title}</h2>
                          <span className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[record.status]}`}>
                            {STATUS_LABEL[record.status]}
                          </span>
                          <span className="text-xs capitalize text-slate-500">{record.record_type}</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-600">
                          {record.member_id ? <Link className="text-brand hover:underline" to={`/admin/members/${record.member_id}`}>{record.member_name}</Link> : record.household_name}
                          {record.reference ? ` · Ref: ${record.reference}` : ""}
                          {record.due_on ? ` · Due ${record.due_on}` : ""}
                        </p>
                      </div>
                      <div className="text-right text-sm tabular-nums">
                        <p className="font-semibold text-slate-900">{formatMinorUnits(record.amount_minor, record.currency_code, record.minor_unit_exponent)}</p>
                        <p className="text-xs text-slate-500">
                          Paid {formatMinorUnits(record.paid_minor, record.currency_code, record.minor_unit_exponent)}
                          {record.balance_minor > 0 ? ` · Due ${formatMinorUnits(record.balance_minor, record.currency_code, record.minor_unit_exponent)}` : ""}
                        </p>
                      </div>
                    </div>
                    {record.notes ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{record.notes}</p> : null}
                    {record.status !== "paid" && record.status !== "voided" ? (
                      <Form method="post" className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
                        <input type="hidden" name="intent" value="record-payment" />
                        <input type="hidden" name="contributionId" value={record.id} />
                        <TextField name="amount" label="Payment amount" required inputMode="decimal" defaultValue={formatMinorUnitsInput(record.balance_minor, record.minor_unit_exponent)} />
                        <TextField name="paidOn" label="Payment date" type="date" required defaultValue={asOfDate} />
                        <label className="text-sm font-medium text-slate-700">
                          Method
                          <select name="method" defaultValue="bank_transfer" className={selectClass}>
                            <option value="bank_transfer">Bank transfer</option>
                            <option value="cash">Cash</option>
                            <option value="card">Card</option>
                            <option value="other">Other</option>
                          </select>
                        </label>
                        <TextField name="reference" label="Payment reference" maxLength={100} />
                        <TextField name="notes" label="Payment notes" maxLength={1000} />
                        <button type="submit" className={buttonClass("secondary", "md")}>Record payment</button>
                      </Form>
                    ) : null}

                    {(payments.length > 0 || record.status === "voided" || !hasActivePayments) ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-medium text-brand">
                          Payment history and corrections ({payments.length})
                        </summary>
                        <div className="mt-2 space-y-3">
                          {payments.map((payment) => (
                            <div key={payment.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                              <div className="flex flex-wrap justify-between gap-2">
                                <span className={payment.voided_at ? "line-through text-slate-500" : "font-medium text-slate-900"}>
                                  {formatMinorUnits(payment.amount_minor, record.currency_code, record.minor_unit_exponent)} · {METHOD_LABEL[payment.method]}
                                </span>
                                <span className="text-slate-500">{payment.paid_on}{payment.voided_at ? " · Voided" : ""}</span>
                              </div>
                              {payment.reference ? <p className="text-slate-600">Ref: {payment.reference}</p> : null}
                              {payment.notes ? <p className="whitespace-pre-wrap text-slate-600">{payment.notes}</p> : null}
                              {payment.voided_at ? (
                                <p className="mt-1 text-xs text-slate-500">Void reason: {payment.void_reason}</p>
                              ) : (
                                <Form method="post" className="mt-2 flex flex-wrap items-end gap-2">
                                  <input type="hidden" name="intent" value="void-payment" />
                                  <input type="hidden" name="paymentId" value={payment.id} />
                                  <TextField name="reason" label="Void reason" required maxLength={500} className="min-w-56 flex-1" />
                                  <button type="submit" className={buttonClass("secondary", "sm")}>Void payment</button>
                                </Form>
                              )}
                            </div>
                          ))}
                          {record.status !== "voided" && !hasActivePayments ? (
                            <Form method="post" className="flex flex-wrap items-end gap-2">
                              <input type="hidden" name="intent" value="void-contribution" />
                              <input type="hidden" name="contributionId" value={record.id} />
                              <TextField name="reason" label="Void record reason" required maxLength={500} className="min-w-56 flex-1" />
                              <button type="submit" className={buttonClass("secondary", "sm")}>Void record</button>
                            </Form>
                          ) : null}
                          {record.status === "voided" ? (
                            <p className="text-xs text-slate-500">Record void reason: {record.void_reason}</p>
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:px-5">
              <span>{count} records · {CONTRIBUTION_PAGE_SIZE} per page</span>
              <div className="flex items-center gap-2">
                {page > 1 ? <Link className={buttonClass("secondary", "sm")} to={pageHref(q, status, page - 1)}>Previous</Link> : null}
                <span>Page {page} of {pageCount}</span>
                {page < pageCount ? <Link className={buttonClass("secondary", "sm")} to={pageHref(q, status, page + 1)}>Next</Link> : null}
              </div>
            </div>
          </>
        ) : (
          <EmptyState icon={BanknotesIcon}>
            {q || status ? "No records match these filters." : "No contribution or invoice records yet. Add one above to begin tracking balances."}
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}

const selectClass =
  "mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15";

function SummaryCard({
  label,
  count,
  amounts,
  emphasis = false,
}: {
  label: string;
  count: number;
  amounts: { code: string; exponent: number; amount: number }[];
  emphasis?: boolean;
}) {
  const totals = amounts.filter((item) => item.amount > 0);
  return (
    <div className={`rounded-xl border p-4 shadow-xs ${emphasis ? "border-red-200 bg-red-50/60" : "border-slate-200 bg-white"}`}>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${emphasis ? "text-red-800" : "text-slate-900"}`}>{count}</p>
      <p className="mt-1 text-xs text-slate-500">
        {totals.length ? totals.map((item) => formatMinorUnits(item.amount, item.code, item.exponent)).join(" · ") : "No balance"}
      </p>
    </div>
  );
}

function pageHref(q: string, status: string, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  params.set("page", String(page));
  return `/admin/contributions?${params}`;
}
