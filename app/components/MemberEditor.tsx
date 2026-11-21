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
  assignmentHistory,
  otherMembers,
  result,
}: {
  member: MemberRow;
  households: HouseholdRow[];
  groups: GroupRow[];
  currentHousehold: (HouseholdRow & { role: string }) | null;
  currentGroups: (GroupRow & { role: string })[];
  relationships: MemberRelationshipRow[];
  history: MemberHistoryRow[];
  assignmentHistory: MemberAssignmentHistoryRow[];
  otherMembers: { id: string; full_name: string }[];
  result?: MemberEditorResult;
}) {
  const currentGroupIds = new Set(currentGroups.map((group) => group.id));
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
            <Field label="First name" name="firstName" required maxLength={120} defaultValue={member.first_name ?? member.full_name} />
            <Field label="Middle name" name="middleName" maxLength={120} defaultValue={member.middle_name ?? ""} />
            <Field label="Last name / family name" name="familyName" required maxLength={120} defaultValue={member.family_name ?? ""} />
            <Field label="Preferred name" name="preferredName" defaultValue={member.preferred_name ?? ""} />
            <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={member.date_of_birth ?? ""} />
            <label className="text-sm font-medium text-slate-700">
              Gender
              <select name="gender" required defaultValue={member.gender ?? "male"} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <Field label="Email" name="email" type="email" defaultValue={member.email ?? ""} />
            <Field label="Phone" name="phone" type="tel" defaultValue={member.phone ?? ""} />
            <Field label="Address" name="address" maxLength={240} defaultValue={member.address ?? ""} />
            <Field label="Postal code" name="postalCode" maxLength={20} defaultValue={member.postal_code ?? ""} />
            <Field label="City" name="city" maxLength={120} defaultValue={member.city ?? ""} />
            <Field label="Country" name="country" maxLength={120} defaultValue={member.country ?? ""} />
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
              <select name="householdRole" defaultValue={currentHousehold?.role ?? "partner"} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
                <option value="head">Head</option>
                <option value="partner">Partner</option>
                <option value="child">Child</option>
              </select>
            </label>
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
        </div>
      ) : null}
    </div>
  );
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
