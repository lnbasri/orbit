import { Form, data } from "react-router";
import { BuildingOffice2Icon, HomeIcon } from "@heroicons/react/24/outline";

import type { Route } from "./+types/households";
import { Notice, EmptyState, PageHeader, Panel } from "~/components/admin";
import { TextField } from "~/components/forms";
import { buttonClass } from "~/components/ui";
import { adminEmailContext } from "~/lib/admin-context";
import { getAppEnv } from "~/lib/env.server";
import { listHouseholds, saveHousehold } from "~/lib/members.server";

export function meta() {
  return [{ title: "Households — ORBIT" }, { name: "robots", content: "noindex" }];
}

export async function loader() {
  return { households: await listHouseholds(getAppEnv().DB) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  if (form.get("intent") !== "save-household") return data({ ok: false, message: "Unknown action." }, { status: 400 });
  const result = await saveHousehold(
    getAppEnv().DB,
    context.get(adminEmailContext),
    {
      name: String(form.get("name") ?? ""),
      address: String(form.get("address") ?? ""),
      postalCode: String(form.get("postalCode") ?? ""),
      city: String(form.get("city") ?? ""),
      country: String(form.get("country") ?? ""),
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
                  <button type="submit" className={`${buttonClass("secondary", "md")} self-end`}>Save household</button>
                </Form>
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
      <button type="submit" className={`${buttonClass("primary", "md")} self-end`}>Add household</button>
    </Form>
  );
}
