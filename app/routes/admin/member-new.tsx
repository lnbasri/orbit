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
    first_name: null,
    middle_name: null,
    family_name: null,
    date_of_birth: null,
    gender: "male",
    address: null,
    postal_code: null,
    city: null,
    country: null,
    preferred_language: null,
    communication_consent: 0,
    communication_consent_updated_at: null,
    archived_at: null,
    email: null,
    phone: null,
    status: "active",
    status_note: null,
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
  const firstName = String(form.get("firstName") ?? "").trim();
  const middleName = String(form.get("middleName") ?? "").trim();
  const familyName = String(form.get("familyName") ?? "").trim();
  const fullName = [firstName, middleName, familyName].filter(Boolean).join(" ");
  const result = await saveMember(
    getAppEnv().DB,
    context.get(adminEmailContext),
    {
      fullName,
      preferredName: String(form.get("preferredName") ?? ""),
      firstName,
      middleName,
      familyName,
      dateOfBirth: String(form.get("dateOfBirth") ?? ""),
      gender: String(form.get("gender") ?? ""),
      address: String(form.get("address") ?? ""),
      postalCode: String(form.get("postalCode") ?? ""),
      city: String(form.get("city") ?? ""),
      country: String(form.get("country") ?? ""),
      preferredLanguage: String(form.get("preferredLanguage") ?? ""),
      communicationConsent: form.get("communicationConsent") === "on",
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
      status: String(form.get("status") ?? "active"),
      statusNote: String(form.get("statusNote") ?? ""),
      joinedOn: String(form.get("joinedOn") ?? ""),
      notes: String(form.get("notes") ?? ""),
    },
    undefined,
    String(form.get("householdId") ?? ""),
    groupIds,
    new Date(),
    Object.fromEntries(groupIds.map((groupId) => [groupId, String(form.get(`groupRole:${groupId}`) ?? "member")])),
    String(form.get("householdRole") ?? "partner"),
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
        consentHistory={[]}
        assignmentHistory={[]}
        otherMembers={[]}
        result={actionData}
      />
    </div>
  );
}
