import { Form, data } from "react-router";
import { BuildingOffice2Icon, HomeIcon } from "@heroicons/react/24/outline";

import type { Route } from "./+types/households";
import { Notice, EmptyState, PageHeader, Panel } from "~/components/admin";
import { TextField } from "~/components/forms";
import { buttonClass } from "~/components/ui";
import { adminEmailContext } from "~/lib/admin-context";
import { getAppEnv } from "~/lib/env.server";
import {
  listHouseholds,
  previewHouseholdLifecycle,
  processHouseholdLifecycle,
  saveHousehold,
} from "~/lib/members.server";

export function meta() {
  return [{ title: "Households — ORBIT" }, { name: "robots", content: "noindex" }];
}

export async function loader() {
  return { households: await listHouseholds(getAppEnv().DB) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "preview-household-lifecycle" || intent === "process-household-lifecycle") {
    const householdId = String(form.get("householdId") ?? "");
    if (!householdId) return data({ ok: false, message: "Household not found." }, { status: 400 });
    if (intent === "preview-household-lifecycle") {
      try {
        const preview = await previewHouseholdLifecycle(getAppEnv().DB, householdId);
        return data(
          {
            ok: true,
            message: `${preview.action}: ${preview.reason}`,
          },
          { status: 200 },
        );
      } catch (error) {
        return data(
          { ok: false, message: error instanceof Error ? error.message : "Lifecycle preview failed." },
          { status: 400 },
        );
      }
    }
    try {
      const result = await processHouseholdLifecycle(
        getAppEnv().DB,
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
  if (intent !== "save-household") return data({ ok: false, message: "Unknown action." }, { status: 400 });
  const result = await saveHousehold(
    getAppEnv().DB,
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
    String(form.get("householdId") ?? "") || undefined,
  );
  return data(result, { status: result.ok ? 200 : 400 });
}

export default function Households({ loaderData, actionData }: Route.ComponentProps) {
  const result = actionData;
  return (
    <div>
      <PageHeader eyebrow="Organisation" title="Households" description="Group people who share a household and maintain their shared address." />
      <Notice result={result} className="mb-5" />
      <Panel title="Add a household" icon={HomeIcon}>
        <HouseholdForm />
      </Panel>
      <Panel title={<>Household directory <span className="text-slate-400 tabular-nums">({loaderData.households.length})</span></>} icon={BuildingOffice2Icon} flush className="mt-6">
        {loaderData.households.length ? (
          <ul className="divide-y divide-slate-100">
            {loaderData.households.map((household) => (
              <li key={household.id} className="px-4 py-4 sm:px-5">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold text-slate-900">{household.name}</h2>
                  <span className="text-xs text-slate-500">{household.member_count} current members</span>
                </div>
                <Form method="post" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <input type="hidden" name="intent" value="save-household" />
                  <input type="hidden" name="householdId" value={household.id} />
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
                  <button type="submit" className={`${buttonClass("secondary", "md")} self-end`}>Save household</button>
                </Form>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Form method="post" className="inline-flex">
                    <input type="hidden" name="intent" value="preview-household-lifecycle" />
                    <input type="hidden" name="householdId" value={household.id} />
                    <button type="submit" className={buttonClass("secondary", "sm")}>Preview lifecycle</button>
                  </Form>
                  <Form method="post" className="inline-flex">
                    <input type="hidden" name="intent" value="process-household-lifecycle" />
                    <input type="hidden" name="householdId" value={household.id} />
                    <button
                      type="submit"
                      onClick={(event) => {
                        if (!window.confirm(`Process household lifecycle for ${household.name}?`)) event.preventDefault();
                      }}
                      className={buttonClass("primary", "sm")}
                    >
                      Process lifecycle
                    </button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={HomeIcon}>No households yet. Add one above, then link members from their profiles.</EmptyState>}
      </Panel>
    </div>
  );
}

function HouseholdForm() {
  return (
    <Form method="post" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <input type="hidden" name="intent" value="save-household" />
      <TextField name="name" label="Household name" required maxLength={120} placeholder="e.g. Hasan household" />
      <TextField name="address" label="Address" maxLength={240} />
      <TextField name="postalCode" label="Postal code" maxLength={20} />
      <TextField name="city" label="City" maxLength={120} />
      <TextField name="country" label="Country" maxLength={120} />
      <label className="text-sm font-medium text-slate-700">
        Status
        <select name="status" defaultValue="active" className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>
      <TextField name="statusNote" label="Status note" maxLength={2000} />
      <button type="submit" className={`${buttonClass("primary", "md")} self-end`}>Add household</button>
    </Form>
  );
}
