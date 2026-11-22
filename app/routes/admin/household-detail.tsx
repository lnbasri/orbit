import { data, Link } from "react-router";
import {
  ArrowLeftIcon,
  BuildingOffice2Icon,
  ClockIcon,
  UserGroupIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";

import type { Route } from "./+types/household-detail";
import { EmptyState, Notice, PageHeader, Panel } from "~/components/admin";
import { TextField } from "~/components/forms";
import { buttonClass } from "~/components/ui";
import { adminEmailContext } from "~/lib/admin-context";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime } from "~/lib/format";
import {
  getHouseholdDetail,
  previewHouseholdLifecycle,
  processHouseholdLifecycle,
  saveHousehold,
} from "~/lib/members.server";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `${loaderData?.household?.name ?? "Household"} — ORBIT` },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const detail = await getHouseholdDetail(getAppEnv().DB, params.id);
  if (!detail) throw data("Household not found.", { status: 404 });
  return detail;
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const db = getAppEnv().DB;
  const householdId = params.id;

  if (intent === "save-household") {
    const result = await saveHousehold(
      db,
      context.get(adminEmailContext),
      {
        name: String(form.get("name") ?? ""),
        address: String(form.get("address") ?? ""),
        postalCode: String(form.get("postalCode") ?? ""),
        city: String(form.get("city") ?? ""),
        country: String(form.get("country") ?? ""),
        status: String(form.get("status") ?? "active"),
        statusNote: String(form.get("statusNote") ?? ""),
      },
      householdId,
    );
    return data(result, { status: result.ok ? 200 : 400 });
  }

  if (intent === "preview-household-lifecycle") {
    try {
      const preview = await previewHouseholdLifecycle(db, householdId);
      return data(
        { ok: true, message: `${preview.action}: ${preview.reason}`, preview },
        { status: 200 },
      );
    } catch (error) {
      return data(
        { ok: false, message: error instanceof Error ? error.message : "Lifecycle preview failed." },
        { status: 400 },
      );
    }
  }

  if (intent === "process-household-lifecycle") {
    try {
      const result = await processHouseholdLifecycle(
        db,
        context.get(adminEmailContext),
        householdId,
      );
      return data(result, { status: result.ok ? 200 : 400 });
    } catch (error) {
      return data(
        { ok: false, message: error instanceof Error ? error.message : "Lifecycle process failed." },
        { status: 400 },
      );
    }
  }

  return data({ ok: false, message: "Unknown action." }, { status: 400 });
}

export default function HouseholdDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { household, currentMembers, formerMembers, audit } = loaderData;
  const result = actionData;

  return (
    <div>
      <PageHeader
        eyebrow="Households"
        title={household.name}
        description={`${household.city || household.country ? [household.city, household.country].filter(Boolean).join(", ") : "No location"} · ${household.status}`}
        back={{ to: "/admin/households", label: "Back to households" }}
      />

      <Notice result={result} className="mb-5" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <div className="space-y-6">
          <Panel title="Current members" icon={UsersIcon} flush>
            {currentMembers.length ? (
              <ul className="divide-y divide-slate-100">
                {currentMembers.map((member) => (
                  <li key={member.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand" aria-hidden="true">
                      {member.full_name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-48 flex-1">
                      <Link to={`/admin/members/${member.id}`} className="font-semibold text-slate-900 hover:text-brand">
                        {member.preferred_name || member.full_name}
                      </Link>
                      {member.email || member.phone ? (
                        <p className="mt-0.5 text-xs text-slate-500">{member.email || member.phone}</p>
                      ) : null}
                    </div>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">
                      {member.role}
                    </span>
                    <time className="text-xs text-slate-500" dateTime={member.valid_from}>
                      Since {formatDateTime(member.valid_from)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={UserGroupIcon}>No current members are linked to this household.</EmptyState>
            )}
          </Panel>

          <Panel title="Previous members" icon={ClockIcon} flush>
            {formerMembers.length ? (
              <ul className="divide-y divide-slate-100">
                {formerMembers.map((member) => (
                  <li key={`${member.id}-${member.valid_from}-${member.valid_until}`} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <Link to={`/admin/members/${member.id}`} className="flex-1 font-medium text-slate-700 hover:text-brand">
                      {member.full_name}
                    </Link>
                    <span className="text-xs font-semibold capitalize text-slate-500">{member.role}</span>
                    <span className="text-xs text-slate-500">
                      {formatDateTime(member.valid_from)} – {member.valid_until ? formatDateTime(member.valid_until) : "Current"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={ClockIcon}>No previous household assignments are recorded.</EmptyState>
            )}
          </Panel>

          <Panel title="Activity" icon={ClockIcon} flush>
            {audit.length ? (
              <ul className="divide-y divide-slate-100">
                {audit.map((entry) => (
                  <li key={entry.id} className="px-4 py-3 sm:px-5">
                    <p className="text-sm font-medium text-slate-800">{entry.action}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDateTime(entry.at)} · {entry.actor}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={ClockIcon}>No household activity is recorded.</EmptyState>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Household details" icon={BuildingOffice2Icon}>
            <Form method="post" className="grid gap-3">
              <input type="hidden" name="intent" value="save-household" />
              <TextField name="name" label="Household name" required maxLength={120} defaultValue={household.name} />
              <TextField name="address" label="Address" maxLength={240} defaultValue={household.address ?? ""} />
              <TextField name="postalCode" label="Postal code" maxLength={20} defaultValue={household.postal_code ?? ""} />
              <TextField name="city" label="City" maxLength={120} defaultValue={household.city ?? ""} />
              <TextField name="country" label="Country" maxLength={120} defaultValue={household.country ?? ""} />
              <label className="text-sm font-medium text-slate-700">
                Status
                <select name="status" defaultValue={household.status} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <TextField name="statusNote" label="Status note" maxLength={2000} defaultValue={household.status_note ?? ""} />
              <button type="submit" className={buttonClass("primary", "md")}>Save household</button>
            </Form>
          </Panel>

          <Panel title="Lifecycle" icon={ClockIcon}>
            <div className="space-y-3">
              <p className="text-sm leading-6 text-slate-600">
                Preview or process head replacement rules for a deceased or moved household head.
              </p>
              <div className="flex flex-wrap gap-2">
                <Form method="post">
                  <input type="hidden" name="intent" value="preview-household-lifecycle" />
                  <button type="submit" className={buttonClass("secondary", "sm")}>Preview</button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="process-household-lifecycle" />
                  <button
                    type="submit"
                    onClick={(event) => {
                      if (!window.confirm(`Process lifecycle for ${household.name}?`)) event.preventDefault();
                    }}
                    className={buttonClass("primary", "sm")}
                  >
                    Process
                  </button>
                </Form>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
