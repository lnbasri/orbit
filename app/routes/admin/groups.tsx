import { Form, data } from "react-router";
import { UserGroupIcon } from "@heroicons/react/24/outline";

import type { Route } from "./+types/groups";
import { EmptyState, Notice, PageHeader, Panel } from "~/components/admin";
import { TextField } from "~/components/forms";
import { buttonClass } from "~/components/ui";
import { adminEmailContext } from "~/lib/admin-context";
import { getAppEnv } from "~/lib/env.server";
import { listGroups, saveGroup } from "~/lib/members.server";

export function meta() {
  return [{ title: "Administrative groups — ORBIT" }, { name: "robots", content: "noindex" }];
}

export async function loader() {
  return { groups: await listGroups(getAppEnv().DB) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  if (form.get("intent") !== "save-group") return data({ ok: false, message: "Unknown action." }, { status: 400 });
  const result = await saveGroup(
    getAppEnv().DB,
    context.get(adminEmailContext),
    {
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
    },
    String(form.get("groupId") ?? "") || undefined,
  );
  return data(result, { status: result.ok ? 200 : 400 });
}

export default function Groups({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div>
      <PageHeader eyebrow="Organisation" title="Administrative groups" description="Maintain committees, boards, and other administrative groups." />
      <Notice result={actionData} className="mb-5" />
      <Panel title="Add a group" icon={UserGroupIcon}>
        <GroupForm />
      </Panel>
      <Panel title={<>Groups <span className="text-slate-400 tabular-nums">({loaderData.groups.length})</span></>} icon={UserGroupIcon} flush className="mt-6">
        {loaderData.groups.length ? (
          <ul className="divide-y divide-slate-100">
            {loaderData.groups.map((group) => (
              <li key={group.id} className="px-4 py-4 sm:px-5">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold text-slate-900">{group.name}</h2>
                  <span className="text-xs text-slate-500">{group.member_count} current members</span>
                </div>
                <Form method="post" className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                  <input type="hidden" name="intent" value="save-group" />
                  <input type="hidden" name="groupId" value={group.id} />
                  <TextField name="name" label="Group name" required maxLength={120} defaultValue={group.name} />
                  <TextField name="description" label="Description" maxLength={500} defaultValue={group.description ?? ""} />
                  <button type="submit" className={buttonClass("secondary", "md")}>Save group</button>
                </Form>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={UserGroupIcon}>No groups yet. Add one above, then assign members from their profiles.</EmptyState>}
      </Panel>
    </div>
  );
}

function GroupForm() {
  return (
    <Form method="post" className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <input type="hidden" name="intent" value="save-group" />
      <TextField name="name" label="Group name" required maxLength={120} placeholder="e.g. Board" />
      <TextField name="description" label="Description" maxLength={500} />
      <button type="submit" className={buttonClass("primary", "md")}>Add group</button>
    </Form>
  );
}
