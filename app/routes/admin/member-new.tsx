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
  const householdMode = String(form.get("householdMode") ?? "none");
  if (!["none", "existing", "new"].includes(householdMode)) {
    return { ok: false, message: "Choose a valid household setup." };
  }
  const groupIds = form.getAll("groupIds").map(String);
  const firstName = String(form.get("firstName") ?? "").trim();
  const middleName = String(form.get("middleName") ?? "").trim();
  const familyName = String(form.get("familyName") ?? "").trim();
  const fullName = [firstName, middleName, familyName].filter(Boolean).join(" ");
  const headAddress = {
    address: String(form.get("address") ?? ""),
    postalCode: String(form.get("postalCode") ?? ""),
    city: String(form.get("city") ?? ""),
    country: String(form.get("country") ?? ""),
  };
  let newHousehold: Parameters<typeof saveMember>[9];
  if (householdMode === "new") {
    const rawCount = String(form.get("additionalMemberCount") ?? "0");
    const count = Number(rawCount);
    if (!Number.isInteger(count) || count < 0 || count > 8) {
      return { ok: false, message: "Choose between 0 and 8 additional household members." };
    }
    const repeatedFields = [
      "additionalFirstName",
      "additionalMiddleName",
      "additionalFamilyName",
      "additionalRole",
      "additionalPreferredName",
      "additionalDateOfBirth",
      "additionalGender",
      "additionalEmail",
      "additionalPhone",
      "additionalPreferredLanguage",
      "additionalCommunicationConsent",
      "additionalAddressMode",
      "additionalAddress",
      "additionalPostalCode",
      "additionalCity",
      "additionalCountry",
    ];
    const values = new Map<string, string[]>();
    for (const name of repeatedFields) {
      const entries = form.getAll(name);
      if (entries.length !== count || entries.some((entry) => typeof entry !== "string")) {
        return { ok: false, message: "Household member details are incomplete. Review the additional member fields." };
      }
      values.set(name, entries.map(String));
    }
    const field = (name: string, index: number) => values.get(name)![index];
    const additionalMembers = Array.from({ length: count }, (_, index) => {
      const addressMode = field("additionalAddressMode", index);
      const email = field("additionalEmail", index);
      const phone = field("additionalPhone", index);
      return {
        role: field("additionalRole", index),
        member: {
          firstName: field("additionalFirstName", index),
          middleName: field("additionalMiddleName", index),
          familyName: field("additionalFamilyName", index),
          fullName: [
            field("additionalFirstName", index),
            field("additionalMiddleName", index),
            field("additionalFamilyName", index),
          ].filter(Boolean).join(" "),
          preferredName: field("additionalPreferredName", index),
          dateOfBirth: field("additionalDateOfBirth", index),
          gender: field("additionalGender", index),
          email,
          phone,
          preferredLanguage: field("additionalPreferredLanguage", index),
          communicationConsent: Boolean(email.trim() || phone.trim()) &&
            field("additionalCommunicationConsent", index) === "yes",
          address: addressMode === "same" ? headAddress.address : field("additionalAddress", index),
          postalCode: addressMode === "same" ? headAddress.postalCode : field("additionalPostalCode", index),
          city: addressMode === "same" ? headAddress.city : field("additionalCity", index),
          country: addressMode === "same" ? headAddress.country : field("additionalCountry", index),
          status: "active",
          statusNote: "",
          joinedOn: "",
          notes: "",
        },
      };
    });
    const useHeadAddress = form.get("householdUseHeadAddress") === "on";
    newHousehold = {
      name: String(form.get("householdName") ?? ""),
      email: String(form.get("householdEmail") ?? ""),
      phone: String(form.get("householdPhone") ?? ""),
      address: useHeadAddress ? headAddress.address : String(form.get("householdAddress") ?? ""),
      postalCode: useHeadAddress ? headAddress.postalCode : String(form.get("householdPostalCode") ?? ""),
      city: useHeadAddress ? headAddress.city : String(form.get("householdCity") ?? ""),
      country: useHeadAddress ? headAddress.country : String(form.get("householdCountry") ?? ""),
      additionalMembers,
    };
  }
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
      ...headAddress,
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
    String(form.get("householdRole") ?? "head"),
    newHousehold,
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
        isNew
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
