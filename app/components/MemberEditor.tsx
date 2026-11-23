import { useEffect, useState } from "react";
import { Form, Link } from "react-router";
import {
  ArrowLeftIcon,
  ClockIcon,
  LinkIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";

import type {
  GroupRow,
  HouseholdRow,
  MemberAssignmentHistoryRow,
  MemberConsentHistoryRow,
  MemberHistoryRow,
  MemberRelationshipRow,
  MemberRow,
} from "~/lib/members.server";
import { formatDateTime } from "~/lib/format";
import { Notice, Panel } from "~/components/admin";
import { buttonClass } from "~/components/ui";

export interface MemberEditorResult {
  ok: boolean;
  message: string;
}

export function MemberEditor({
  member,
  households,
  groups,
  currentHousehold,
  currentGroups,
  relationships,
  history,
  consentHistory,
  assignmentHistory,
  otherMembers,
  result,
  isNew = false,
}: {
  member: MemberRow;
  households: HouseholdRow[];
  groups: GroupRow[];
  currentHousehold: (HouseholdRow & { role: string }) | null;
  currentGroups: (GroupRow & { role: string })[];
  relationships: MemberRelationshipRow[];
  history: MemberHistoryRow[];
  consentHistory: MemberConsentHistoryRow[];
  assignmentHistory: MemberAssignmentHistoryRow[];
  otherMembers: { id: string; full_name: string }[];
  result?: MemberEditorResult;
  isNew?: boolean;
}) {
  const currentGroupIds = new Set(currentGroups.map((group) => group.id));
  const [householdMode, setHouseholdMode] = useState<"none" | "existing" | "new">("none");
  const [headFirstName, setHeadFirstName] = useState(member.first_name ?? "");
  const [headFamilyName, setHeadFamilyName] = useState(member.family_name ?? "");
  const [headEmail, setHeadEmail] = useState(member.email ?? "");
  const [headPhone, setHeadPhone] = useState(member.phone ?? "");
  const [headAddress, setHeadAddress] = useState({
    address: member.address ?? "",
    postalCode: member.postal_code ?? "",
    city: member.city ?? "",
    country: member.country ?? "",
  });
  return (
    <div>
      <Link to="/admin/members" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand">
        <ArrowLeftIcon className="size-4" aria-hidden="true" /> Back to members
      </Link>
      <Notice result={result} className="mb-5" />
      <Form method="post" className="space-y-6">
        <input type="hidden" name="intent" value="save-member" />
        <Panel title="Personal information">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" name="firstName" required maxLength={120} defaultValue={member.first_name ?? member.full_name} onChange={(event) => setHeadFirstName(event.currentTarget.value)} />
            <Field label="Middle name" name="middleName" maxLength={120} defaultValue={member.middle_name ?? ""} />
            <Field
              label="Last name / family name"
              name="familyName"
              required
              maxLength={120}
              defaultValue={member.family_name ?? ""}
              onChange={(event) => setHeadFamilyName(event.currentTarget.value)}
            />
            <Field label="Preferred name" name="preferredName" defaultValue={member.preferred_name ?? ""} />
            <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={member.date_of_birth ?? ""} />
            <label className="text-sm font-medium text-slate-700">
              Gender
              <select name="gender" required defaultValue={member.gender ?? "male"} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <Field label="Email" name="email" type="email" defaultValue={member.email ?? ""} onChange={(event) => setHeadEmail(event.currentTarget.value)} />
            <Field label="Phone" name="phone" type="tel" defaultValue={member.phone ?? ""} onChange={(event) => setHeadPhone(event.currentTarget.value)} />
            <Field label="Address" name="address" maxLength={240} defaultValue={member.address ?? ""} onChange={(event) => setHeadAddress((current) => ({ ...current, address: event.currentTarget.value }))} />
            <Field label="Postal code" name="postalCode" maxLength={20} defaultValue={member.postal_code ?? ""} onChange={(event) => setHeadAddress((current) => ({ ...current, postalCode: event.currentTarget.value }))} />
            <Field label="City" name="city" maxLength={120} defaultValue={member.city ?? ""} onChange={(event) => setHeadAddress((current) => ({ ...current, city: event.currentTarget.value }))} />
            <Field label="Country" name="country" maxLength={120} defaultValue={member.country ?? ""} onChange={(event) => setHeadAddress((current) => ({ ...current, country: event.currentTarget.value }))} />
            <Field label="Preferred language" name="preferredLanguage" maxLength={80} defaultValue={member.preferred_language ?? ""} placeholder="e.g. English" />
            <label className="flex min-h-11 items-center gap-2 self-end text-sm font-medium text-slate-700">
              <input type="checkbox" name="communicationConsent" defaultChecked={member.communication_consent === 1} className="size-4 rounded border-slate-300 text-brand focus:ring-brand" />
              Communication consent
            </label>
            <label className="text-sm font-medium text-slate-700">
              Membership status
              <select name="status" defaultValue={member.status} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="moved">Moved</option>
                <option value="deceased">Deceased</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">
              Status note
              <textarea name="statusNote" rows={2} maxLength={2000} defaultValue={member.status_note ?? ""} placeholder="Reason or relevant information for this status" className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15" />
            </label>
            <Field label="Joined on" name="joinedOn" type="date" defaultValue={member.joined_on ?? ""} />
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">
              Notes
              <textarea name="notes" rows={3} maxLength={2000} defaultValue={member.notes ?? ""} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15" />
            </label>
          </div>
        </Panel>

        <Panel title="Household and administrative groups" icon={LinkIcon}>
          <div className="grid gap-5 md:grid-cols-2">
            {isNew ? (
              <div className="space-y-4 md:col-span-2">
                <label className="block text-sm font-medium text-slate-700">
                  Household setup
                  <select
                    name="householdMode"
                    value={householdMode}
                    onChange={(event) => setHouseholdMode(event.currentTarget.value as typeof householdMode)}
                    className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
                  >
                    <option value="none">No household</option>
                    <option value="existing">Join an existing household</option>
                    <option value="new">Create a new household — this member is the Head</option>
                  </select>
                </label>
                {householdMode === "existing" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium text-slate-700">
                      Household
                      <select name="householdId" required defaultValue="" className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                        <option value="" disabled>Select a household</option>
                        {households.filter((household) => household.status === "active").map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}
                      </select>
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Household role
                      <select name="householdRole" defaultValue="partner" className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                        <option value="head">Head</option>
                        <option value="partner">Partner</option>
                        <option value="child">Child</option>
                      </select>
                    </label>
                  </div>
                ) : null}
                {householdMode === "new" ? (
                  <>
                    <input type="hidden" name="householdId" value="" />
                    <input type="hidden" name="householdRole" value="head" />
                    <HouseholdCreateFields
                      firstName={headFirstName}
                      familyName={headFamilyName}
                      headAddress={headAddress}
                      headEmail={headEmail}
                      headPhone={headPhone}
                      households={households}
                    />
                  </>
                ) : householdMode === "none" ? (
                  <>
                    <input type="hidden" name="householdId" value="" />
                    <input type="hidden" name="householdRole" value="head" />
                  </>
                ) : null}
              </div>
            ) : (
              <>
                <label className="text-sm font-medium text-slate-700">
                  Household
                  <select name="householdId" defaultValue={currentHousehold?.id ?? ""} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                    <option value="">No household</option>
                    {households.filter((household) => household.status === "active").map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}
                  </select>
                  {currentHousehold ? <span className="mt-1 block text-xs text-slate-500">Current link role: {currentHousehold.role}</span> : null}
                  <span className="mt-1 block text-xs text-slate-500">Each member belongs to one current household only.</span>
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Household role
                  <select name="householdRole" defaultValue={currentHousehold?.role ?? "partner"} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                    <option value="head">Head</option>
                    <option value="partner">Partner</option>
                    <option value="child">Child</option>
                  </select>
                </label>
              </>
            )}
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">Groups</legend>
              {groups.length ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {groups.map((group) => (
                    <div key={group.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-slate-200 p-2">
                      <label className="flex items-center gap-2 px-1 text-sm text-slate-700">
                        <input type="checkbox" name="groupIds" value={group.id} defaultChecked={currentGroupIds.has(group.id)} className="size-4 rounded border-slate-300 text-brand focus:ring-brand" />
                        {group.name}
                      </label>
                      <input
                        type="text"
                        name={`groupRole:${group.id}`}
                        maxLength={80}
                        aria-label={`${group.name} role`}
                        placeholder="Role"
                        defaultValue={currentGroups.find((current) => current.id === group.id)?.role ?? "member"}
                        className="min-h-9 min-w-0 rounded-md border border-slate-200 px-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
                      />
                    </div>
                  ))}
                </div>
              ) : <p className="mt-2 text-sm text-slate-500">Create a group to assign this member.</p>}
              {currentGroups.length ? <p className="mt-2 text-xs text-slate-500">Current group role: {currentGroups.map((group) => `${group.name}: ${group.role}`).join(", ")}</p> : null}
            </fieldset>
          </div>
        </Panel>
        <button type="submit" className={buttonClass("primary", "md")}>Save member</button>
      </Form>
      {member.id ? (
        <Form method="post" className="mt-4">
          <input type="hidden" name="intent" value={member.archived_at ? "restore-member" : "archive-member"} />
          <button
            type="submit"
            onClick={(event) => {
              if (!window.confirm(member.archived_at ? "Restore this member?" : "Archive this member?")) event.preventDefault();
            }}
            className={buttonClass(member.archived_at ? "secondary" : "danger", "sm")}
          >
            {member.archived_at ? "Restore member" : "Archive member"}
          </button>
        </Form>
      ) : null}

      {member.id ? (
        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          <Panel title="Relationships between members" icon={UserPlusIcon}>
            <Form method="post" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <input type="hidden" name="intent" value="add-relationship" />
              <label className="text-sm font-medium text-slate-700">
                Related member
                <select name="relatedMemberId" required defaultValue="" className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                  <option value="" disabled>Select a member</option>
                  {otherMembers.map((other) => <option key={other.id} value={other.id}>{other.full_name}</option>)}
                </select>
              </label>
              <Field label="Relationship" name="relationship" required maxLength={80} placeholder="e.g. parent, spouse, sibling" />
              <button type="submit" className={buttonClass("secondary", "md")}>Add link</button>
            </Form>
            {relationships.length ? (
              <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
                {relationships.map((relation) => (
                  <li key={relation.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-slate-900">{relation.related_name}</span>
                      <span className="text-slate-500"> · {relation.relationship}</span>
                    </div>
                    <Form method="post">
                      <input type="hidden" name="intent" value="end-relationship" />
                      <input type="hidden" name="relationshipId" value={relation.id} />
                      <button type="submit" className="text-sm font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-red-700">End link</button>
                    </Form>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-4 text-sm text-slate-500">No current relationships recorded.</p>}
          </Panel>
          <Panel title="Change history" icon={ClockIcon}>
            {history.length ? (
              <ol className="space-y-4">
                {history.map((entry) => (
                  <li key={entry.id} className="border-l-2 border-brand-200 pl-3">
                    <p className="text-xs text-slate-500">{formatDateTime(entry.changed_at)} · {entry.changed_by}</p>
                    <dl className="mt-2 space-y-1">
                      {Object.entries(JSON.parse(entry.changes_json) as Record<string, { from: string | null; to: string | null }>).map(([field, change]) => (
                        <div key={field} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
                          <dt className="font-medium text-slate-600">{field.replaceAll("_", " ")}</dt>
                          <dd className="break-words text-slate-700">{change.from ?? "—"} <span className="text-slate-400">→</span> {change.to ?? "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-slate-500">Changes to this profile will appear here.</p>}
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h3 className="mb-3 text-xs font-semibold tracking-wide text-slate-600 uppercase">Household, group, and relationship history</h3>
              {assignmentHistory.length ? (
                <ol className="space-y-3">
                  {assignmentHistory.map((entry, index) => (
                    <li key={`${entry.kind}-${entry.valid_from}-${index}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
                      <span className="min-w-0 flex-1 text-slate-700">
                        <span className="font-medium">{entry.kind}:</span> {entry.label}
                        {entry.role ? ` · ${entry.role}` : ""}
                      </span>
                      <span className="text-right text-slate-500">
                        {formatDateTime(entry.valid_from)} – {entry.valid_until ? formatDateTime(entry.valid_until) : "Current"}
                        <span className="block">Added by {entry.changed_by}{entry.ended_by ? ` · ended by ${entry.ended_by}` : ""}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-slate-500">No household, group, or relationship changes recorded.</p>}
            </div>
          </Panel>

          <Panel title="Communication consent history" icon={ClockIcon}>
            <p className="mb-4 text-sm text-slate-600">
              Current setting: <span className="font-semibold">{member.communication_consent === 1 ? "Yes" : "No"}</span>
              {consentHistory[0] ? (
                <> · Last recorded {formatDateTime(consentHistory[0].changed_at)} by {consentHistory[0].changed_by}</>
              ) : null}
            </p>
            {consentHistory.length ? (
              <ol className="space-y-4">
                {consentHistory.map((entry) => (
                  <li key={entry.id} className="border-l-2 border-emerald-200 pl-3">
                    <p className="text-xs text-slate-500">{formatDateTime(entry.changed_at)} · {entry.changed_by}</p>
                    <dl className="mt-2 space-y-1">
                      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
                        <dt className="font-medium text-slate-600">Communication consent</dt>
                        <dd className="break-words text-slate-700">
                          {consentLabel(entry.consent_from)} <span className="text-slate-400">→</span> {consentLabel(entry.consent_to)}
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-slate-500">No consent changes are recorded for this member.</p>}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

interface AdditionalMemberDraft {
  role: "partner" | "child";
  firstName: string;
  middleName: string;
  familyName: string;
  familyNameFollowsHead: boolean;
  preferredName: string;
  dateOfBirth: string;
  gender: "male" | "female";
  email: string;
  phone: string;
  preferredLanguage: string;
  communicationConsent: boolean;
  addressMode: "same" | "different";
  address: string;
  postalCode: string;
  city: string;
  country: string;
}

function newAdditionalMember(familyName: string, index: number): AdditionalMemberDraft {
  return {
    role: index === 0 ? "partner" : "child",
    firstName: "",
    middleName: "",
    familyName,
    familyNameFollowsHead: true,
    preferredName: "",
    dateOfBirth: "",
    gender: "male",
    email: "",
    phone: "",
    preferredLanguage: "",
    communicationConsent: false,
    addressMode: "same",
    address: "",
    postalCode: "",
    city: "",
    country: "",
  };
}

function HouseholdCreateFields({
  firstName,
  familyName,
  headAddress,
  headEmail,
  headPhone,
  households,
}: {
  firstName: string;
  familyName: string;
  headAddress: { address: string; postalCode: string; city: string; country: string };
  headEmail: string;
  headPhone: string;
  households: HouseholdRow[];
}) {
  const [householdName, setHouseholdName] = useState(familyName);
  const [householdNameEdited, setHouseholdNameEdited] = useState(false);
  const [useHeadAddress, setUseHeadAddress] = useState(true);
  const [householdAddress, setHouseholdAddress] = useState(headAddress);
  const [householdAddressEdited, setHouseholdAddressEdited] = useState(false);
  const [householdEmail, setHouseholdEmail] = useState(headEmail);
  const [householdEmailEdited, setHouseholdEmailEdited] = useState(false);
  const [householdPhone, setHouseholdPhone] = useState(headPhone);
  const [householdPhoneEdited, setHouseholdPhoneEdited] = useState(false);
  const [additionalCount, setAdditionalCount] = useState(0);
  const [additionalMembers, setAdditionalMembers] = useState<AdditionalMemberDraft[]>([]);

  useEffect(() => {
    if (!householdNameEdited) setHouseholdName(familyName);
    setAdditionalMembers((current) =>
      current.map((member) =>
        member.familyNameFollowsHead ? { ...member, familyName } : member,
      ),
    );
  }, [familyName, householdNameEdited]);

  useEffect(() => {
    if (!householdAddressEdited) setHouseholdAddress(headAddress);
  }, [headAddress, householdAddressEdited]);

  useEffect(() => {
    if (!householdEmailEdited) setHouseholdEmail(headEmail);
  }, [headEmail, householdEmailEdited]);

  useEffect(() => {
    if (!householdPhoneEdited) setHouseholdPhone(headPhone);
  }, [headPhone, householdPhoneEdited]);

  function resizeAdditionalMembers(count: number) {
    setAdditionalCount(count);
    setAdditionalMembers((current) => {
      const next = current.slice(0, count);
      while (next.length < count) {
        next.push(newAdditionalMember(familyName, next.length));
      }
      return next;
    });
  }

  function updateMember(index: number, patch: Partial<AdditionalMemberDraft>) {
    setAdditionalMembers((current) =>
      current.map((member, memberIndex) => {
        if (memberIndex !== index) return member;
        const updated = {
          ...member,
          ...patch,
          ...(patch.familyName !== undefined ? { familyNameFollowsHead: false } : {}),
        };
        if (!updated.email.trim() && !updated.phone.trim()) {
          updated.communicationConsent = false;
        }
        return updated;
      }),
    );
  }

  const partnerCount = additionalMembers.filter((member) => member.role === "partner").length;
  const householdNameKey = (name: string) =>
    name.trim().replace(/[A-Z]/g, (character) => character.toLowerCase());
  const householdNameExists = households.some(
    (household) => householdNameKey(household.name) === householdNameKey(householdName),
  );
  const suggestedName = [firstName, familyName].map((name) => name.trim()).filter(Boolean).join(" ");
  const suggestedNameExists = households.some(
    (household) => householdNameKey(household.name) === householdNameKey(suggestedName),
  );

  return (
    <div className="space-y-5 rounded-lg border border-brand-100 bg-brand-50/40 p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Household name"
          name="householdName"
          required
          maxLength={120}
          value={householdName}
          onChange={(event) => {
            setHouseholdNameEdited(true);
            setHouseholdName(event.currentTarget.value);
          }}
        />
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="householdUseHeadAddress"
            checked={useHeadAddress}
            onChange={(event) => setUseHeadAddress(event.currentTarget.checked)}
            className="size-4 rounded border-slate-300 text-brand focus:ring-brand"
          />
          Use the Head&apos;s address for the household
        </label>
      </div>
      {householdNameExists ? (
        <div role="alert" className="-mt-2 flex flex-wrap items-center gap-2 text-sm text-red-700">
          <span>
            This household name is already in use.
            {suggestedNameExists
              ? ` “${suggestedName}” is also in use; enter a different unique name.`
              : " You can use the Head’s first and family names instead."}
          </span>
          {!suggestedNameExists && suggestedName ? (
            <button
              type="button"
              onClick={() => {
                setHouseholdNameEdited(true);
                setHouseholdName(suggestedName);
              }}
              className="font-semibold underline underline-offset-2"
            >
              Use “{suggestedName}”
            </button>
          ) : null}
        </div>
      ) : (
        <p className="-mt-2 text-xs text-slate-500">
          The name defaults to the Head&apos;s family name and stays editable.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Household email"
          name="householdEmail"
          type="email"
          maxLength={254}
          value={householdEmail}
          onChange={(event) => {
            setHouseholdEmailEdited(true);
            setHouseholdEmail(event.currentTarget.value);
          }}
        />
        <Field
          label="Household phone"
          name="householdPhone"
          type="tel"
          maxLength={40}
          value={householdPhone}
          onChange={(event) => {
            setHouseholdPhoneEdited(true);
            setHouseholdPhone(event.currentTarget.value);
          }}
        />
      </div>
      <p className="-mt-3 text-xs text-slate-500">
        These contacts default to the Head&apos;s details and can be changed for the household.
      </p>
      {useHeadAddress ? (
        <p className="text-xs text-slate-500">The household will use the Head&apos;s address.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Household address"
            name="householdAddress"
            maxLength={240}
            value={householdAddress.address}
            onChange={(event) => {
              setHouseholdAddressEdited(true);
              setHouseholdAddress((current) => ({ ...current, address: event.currentTarget.value }));
            }}
          />
          <Field
            label="Postal code"
            name="householdPostalCode"
            maxLength={20}
            value={householdAddress.postalCode}
            onChange={(event) => {
              setHouseholdAddressEdited(true);
              setHouseholdAddress((current) => ({ ...current, postalCode: event.currentTarget.value }));
            }}
          />
          <Field
            label="City"
            name="householdCity"
            maxLength={120}
            value={householdAddress.city}
            onChange={(event) => {
              setHouseholdAddressEdited(true);
              setHouseholdAddress((current) => ({ ...current, city: event.currentTarget.value }));
            }}
          />
          <Field
            label="Country"
            name="householdCountry"
            maxLength={120}
            value={householdAddress.country}
            onChange={(event) => {
              setHouseholdAddressEdited(true);
              setHouseholdAddress((current) => ({ ...current, country: event.currentTarget.value }));
            }}
          />
        </div>
      )}

      <div className="max-w-xs">
        <label className="text-sm font-medium text-slate-700">
          How many other household members?
          <select
            name="additionalMemberCount"
            required
            value={additionalCount}
            onChange={(event) => resizeAdditionalMembers(Number(event.currentTarget.value))}
            className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
          >
            {Array.from({ length: 9 }, (_, count) => (
              <option key={count} value={count}>{count}</option>
            ))}
          </select>
        </label>
      </div>
      {additionalMembers.length ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Add each person&apos;s basic details. Their address defaults to the Head&apos;s; only enter another address when it differs.
          </p>
          {partnerCount > 1 ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              A household can have only one partner. Change the extra partner to Child.
            </p>
          ) : null}
          {additionalMembers.map((member, index) => (
            <fieldset key={index} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
              <legend className="px-1 text-sm font-semibold text-slate-800">Household member {index + 1}</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" name="additionalFirstName" required maxLength={120} value={member.firstName} onChange={(event) => updateMember(index, { firstName: event.currentTarget.value })} />
                <Field label="Middle name" name="additionalMiddleName" maxLength={120} value={member.middleName} onChange={(event) => updateMember(index, { middleName: event.currentTarget.value })} />
                <Field label="Family name" name="additionalFamilyName" required maxLength={120} value={member.familyName} onChange={(event) => updateMember(index, { familyName: event.currentTarget.value })} />
                <label className="text-sm font-medium text-slate-700">
                  Household role
                  <select name="additionalRole" value={member.role} onChange={(event) => updateMember(index, { role: event.currentTarget.value as AdditionalMemberDraft["role"] })} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                    <option value="partner">Partner</option>
                    <option value="child">Child</option>
                  </select>
                </label>
                <Field label="Preferred name" name="additionalPreferredName" maxLength={120} value={member.preferredName} onChange={(event) => updateMember(index, { preferredName: event.currentTarget.value })} />
                <Field label="Date of birth" name="additionalDateOfBirth" type="date" value={member.dateOfBirth} onChange={(event) => updateMember(index, { dateOfBirth: event.currentTarget.value })} />
                <label className="text-sm font-medium text-slate-700">
                  Gender
                  <select name="additionalGender" value={member.gender} onChange={(event) => updateMember(index, { gender: event.currentTarget.value as AdditionalMemberDraft["gender"] })} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </label>
                <Field label="Email (optional)" name="additionalEmail" type="email" value={member.email} onChange={(event) => updateMember(index, { email: event.currentTarget.value })} />
                <Field label="Phone (optional)" name="additionalPhone" type="tel" value={member.phone} onChange={(event) => updateMember(index, { phone: event.currentTarget.value })} />
                <Field label="Preferred language (optional)" name="additionalPreferredLanguage" maxLength={80} value={member.preferredLanguage} onChange={(event) => updateMember(index, { preferredLanguage: event.currentTarget.value })} />
                {member.email.trim() || member.phone.trim() ? (
                  <label className="text-sm font-medium text-slate-700">
                    Communication consent
                    <select name="additionalCommunicationConsent" value={member.communicationConsent ? "yes" : "no"} onChange={(event) => updateMember(index, { communicationConsent: event.currentTarget.value === "yes" })} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                      <option value="no">No consent recorded</option>
                      <option value="yes">Consent given</option>
                    </select>
                  </label>
                ) : (
                  <input type="hidden" name="additionalCommunicationConsent" value="no" />
                )}
                <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                  Address
                  <select name="additionalAddressMode" value={member.addressMode} onChange={(event) => updateMember(index, { addressMode: event.currentTarget.value as AdditionalMemberDraft["addressMode"] })} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                    <option value="same">Same as the Head</option>
                    <option value="different">This member has a different address</option>
                  </select>
                </label>
              </div>
              {member.addressMode === "different" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Different address" name="additionalAddress" maxLength={240} value={member.address} onChange={(event) => updateMember(index, { address: event.currentTarget.value })} />
                  <Field label="Postal code" name="additionalPostalCode" maxLength={20} value={member.postalCode} onChange={(event) => updateMember(index, { postalCode: event.currentTarget.value })} />
                  <Field label="City" name="additionalCity" maxLength={120} value={member.city} onChange={(event) => updateMember(index, { city: event.currentTarget.value })} />
                  <Field label="Country" name="additionalCountry" maxLength={120} value={member.country} onChange={(event) => updateMember(index, { country: event.currentTarget.value })} />
                </div>
              ) : (
                <>
                  <input type="hidden" name="additionalAddress" value="" />
                  <input type="hidden" name="additionalPostalCode" value="" />
                  <input type="hidden" name="additionalCity" value="" />
                  <input type="hidden" name="additionalCountry" value="" />
                  <p className="text-xs text-slate-500">The Head&apos;s address will be copied to this member&apos;s profile.</p>
                </>
              )}
            </fieldset>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function consentLabel(value: number | null) {
  if (value === 1) return "Yes";
  if (value === 0) return "No";
  return "Not recorded";
}

function Field({
  label,
  name,
  type = "text",
  ...props
}: { label: string; name: string; type?: string } & Omit<React.ComponentProps<"input">, "name" | "type">) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <input name={name} type={type} {...props} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15" />
    </label>
  );
}
