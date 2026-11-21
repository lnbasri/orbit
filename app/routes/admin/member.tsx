import { data } from "react-router";

import type { Route } from "./+types/member";
import { MemberEditor } from "~/components/MemberEditor";
import { adminEmailContext } from "~/lib/admin-context";
import { getAppEnv } from "~/lib/env.server";
import {
  addMemberRelationship,
  endMemberRelationship,
  getMemberProfile,
  listActiveMembers,
  listGroups,
  listHouseholds,
  saveMember,
} from "~/lib/members.server";

export async function loader({ params }: Route.LoaderArgs) {
  const db = getAppEnv().DB;
  const id = params.id;
  const [profile, households, groups, otherMembers] = await Promise.all([
    getMemberProfile(db, id),
    listHouseholds(db),
    listGroups(db),
    listActiveMembers(db, id),
  ]);
  const member = profile.member;
  if (!member) throw data("Member not found.", { status: 404 });
  return { ...profile, member, households, allGroups: groups, otherMembers };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const form = await request.formData();
  const db = getAppEnv().DB;
  const actor = context.get(adminEmailContext);
  const id = params.id;
  const intent = String(form.get("intent") ?? "");

  if (intent === "save-member") {
    const groupIds = form.getAll("groupIds").map(String);
    const result = await saveMember(
      db,
      actor,
      {
        fullName: String(form.get("fullName") ?? ""),
        preferredName: String(form.get("preferredName") ?? ""),
        email: String(form.get("email") ?? ""),
        phone: String(form.get("phone") ?? ""),
        status: String(form.get("status") ?? ""),
        joinedOn: String(form.get("joinedOn") ?? ""),
        notes: String(form.get("notes") ?? ""),
      },
      id,
      String(form.get("householdId") ?? ""),
      groupIds,
      new Date(),
      Object.fromEntries(groupIds.map((groupId) => [groupId, String(form.get(`groupRole:${groupId}`) ?? "member")])),
    );
    return data(result, { status: result.ok ? 200 : 400 });
  }
  if (intent === "add-relationship") {
    const result = await addMemberRelationship(
      db,
      actor,
      id,
      String(form.get("relatedMemberId") ?? ""),
      String(form.get("relationship") ?? ""),
    );
    return data(result, { status: result.ok ? 200 : 400 });
  }
  if (intent === "end-relationship") {
    const result = await endMemberRelationship(db, actor, id, String(form.get("relationshipId") ?? ""));
    return data(result, { status: result.ok ? 200 : 400 });
  }
  return data({ ok: false, message: "Unknown action." }, { status: 400 });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.member?.full_name ?? "Member"} — ORBIT` }, { name: "robots", content: "noindex" }];
}

export default function MemberProfile({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div>
      <h1 className="mb-6 text-gradient-brand text-2xl font-bold tracking-tight sm:text-[1.75rem]">
        {loaderData.member.full_name}
      </h1>
      <MemberEditor
        member={loaderData.member}
        households={loaderData.households}
        groups={loaderData.allGroups}
        currentHousehold={loaderData.household}
        currentGroups={loaderData.groups}
        relationships={loaderData.relationships}
        history={loaderData.history}
        assignmentHistory={loaderData.assignmentHistory}
        otherMembers={loaderData.otherMembers}
        result={actionData}
      />
    </div>
  );
}
