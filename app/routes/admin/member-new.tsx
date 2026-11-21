import { redirect } from "react-router";

import type { Route } from "./+types/member-new";
import { MemberEditor } from "~/components/MemberEditor";
import { adminEmailContext } from "~/lib/admin-context";
import { getAppEnv } from "~/lib/env.server";
import { listGroups, listHouseholds, saveMember, type MemberRow } from "~/lib/members.server";

export function meta() {
  return [{ title: "Add member — ORBIT" }, { name: "robots", content: "noindex" }];
}

export async function loader() {
  const db = getAppEnv().DB;
  const [households, groups] = await Promise.all([listHouseholds(db), listGroups(db)]);
  const member: MemberRow = {
    id: "",
    full_name: "",
    preferred_name: null,
    email: null,
    phone: null,
    status: "active",
    joined_on: null,
    notes: null,
    created_at: "",
    updated_at: "",
  };
  return { member, households, groups };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  if (form.get("intent") !== "save-member") return { ok: false, message: "Unknown action." };
  const groupIds = form.getAll("groupIds").map(String);
  const result = await saveMember(
    getAppEnv().DB,
    context.get(adminEmailContext),
    {
      fullName: String(form.get("fullName") ?? ""),
      preferredName: String(form.get("preferredName") ?? ""),
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
      status: String(form.get("status") ?? "active"),
      joinedOn: String(form.get("joinedOn") ?? ""),
      notes: String(form.get("notes") ?? ""),
    },
    undefined,
    String(form.get("householdId") ?? ""),
    groupIds,
    new Date(),
    Object.fromEntries(groupIds.map((groupId) => [groupId, String(form.get(`groupRole:${groupId}`) ?? "member")])),
  );
  if (result.ok) throw redirect(`/admin/members/${result.id}`);
  return result;
}

export default function NewMember({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div>
      <h1 className="mb-6 text-gradient-brand text-2xl font-bold tracking-tight sm:text-[1.75rem]">Add a member</h1>
      <MemberEditor
        member={loaderData.member}
        households={loaderData.households}
        groups={loaderData.groups}
        currentHousehold={null}
        currentGroups={[]}
        relationships={[]}
        history={[]}
        assignmentHistory={[]}
        otherMembers={[]}
        result={actionData}
      />
    </div>
  );
}
