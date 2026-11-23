import { Link } from "react-router";
import {
  ArrowRightIcon,
  BuildingOffice2Icon,
  ClockIcon,
  ExclamationTriangleIcon,
  RectangleGroupIcon,
  UserGroupIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";

import type { Route } from "./+types/dashboard";
import { EmptyState, PageHeader, Panel, Stat, StatGroup } from "~/components/admin";
import { buttonClass } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import { getAppEnv } from "~/lib/env.server";
import { getDashboardReports } from "~/lib/reports.server";

export function meta() {
  return [{ title: "ORBIT — Organisation overview" }, { name: "robots", content: "noindex" }];
}

export async function loader() {
  const db = getAppEnv().DB;
  const [
    members,
    active,
    inactive,
    moved,
    deceased,
    households,
    groups,
    householdsWithoutHead,
    membersWithoutContact,
    recentMembers,
    reports,
  ] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM members WHERE archived_at IS NULL").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM members WHERE archived_at IS NULL AND status = 'active'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM members WHERE archived_at IS NULL AND status = 'inactive'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM members WHERE archived_at IS NULL AND status = 'moved'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM members WHERE archived_at IS NULL AND status = 'deceased'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM households").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM groups").first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM households h
         WHERE NOT EXISTS (SELECT 1 FROM member_households mh WHERE mh.household_id = h.id AND mh.valid_until IS NULL AND mh.role = 'head')`,
      )
      .first<{ count: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM members WHERE archived_at IS NULL AND (email IS NULL OR email = '') AND (phone IS NULL OR phone = '')",
      )
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT id, full_name, status, created_at FROM members WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 5`,
      )
      .all<{ id: string; full_name: string; status: string; created_at: string }>(),
    getDashboardReports(db),
  ]);
  return {
    members: members?.count ?? 0,
    activeMembers: active?.count ?? 0,
    inactiveMembers: inactive?.count ?? 0,
    movedMembers: moved?.count ?? 0,
    deceasedMembers: deceased?.count ?? 0,
    households: households?.count ?? 0,
    groups: groups?.count ?? 0,
    householdsWithoutHead: householdsWithoutHead?.count ?? 0,
    membersWithoutContact: membersWithoutContact?.count ?? 0,
    recentMembers: recentMembers.results,
    reports,
  };
}

export default function OrbitDashboard({ loaderData }: Route.ComponentProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ORBIT · Overview"
        title="Organisation dashboard"
        description="A clear starting point for member records, households, and administrative groups."
      />
      <StatGroup>
        <Stat icon={UsersIcon} label="Members" value={loaderData.members} sub={`${loaderData.activeMembers} active`} />
        <Stat icon={BuildingOffice2Icon} label="Households" value={loaderData.households} />
        <Stat icon={RectangleGroupIcon} label="Groups" value={loaderData.groups} />
        <Stat icon={UsersIcon} label="Inactive members" value={loaderData.inactiveMembers} />
        <Stat icon={ClockIcon} label="Moved" value={loaderData.movedMembers} />
        <Stat icon={ClockIcon} label="Deceased" value={loaderData.deceasedMembers} />
        {loaderData.householdsWithoutHead > 0 ? (
          <Stat icon={ExclamationTriangleIcon} label="Households without head" value={loaderData.householdsWithoutHead} sub="Needs attention" />
        ) : null}
        {loaderData.membersWithoutContact > 0 ? (
          <Stat icon={ExclamationTriangleIcon} label="Members without contact" value={loaderData.membersWithoutContact} sub="No email or phone" />
        ) : null}
      </StatGroup>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Member status" icon={UsersIcon}>
          <ReportBars rows={loaderData.reports.memberStatuses} />
        </Panel>

        <Panel title="Member age" icon={UserGroupIcon}>
          <p className="mb-3 text-xs leading-5 text-slate-500">
            Age is calculated as of today for non-archived, non-deceased members. Missing, invalid, or future dates are shown as unknown.
          </p>
          <ReportBars rows={loaderData.reports.ageGroups} />
        </Panel>

        <Panel title="Households" icon={BuildingOffice2Icon}>
          <div className="grid gap-6 sm:grid-cols-2">
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Status</h3>
              <ReportBars rows={loaderData.reports.householdStatuses} />
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Current size</h3>
              <p className="mb-2 text-xs leading-5 text-slate-500">
                Counts current assignments to non-archived members.
              </p>
              <ReportBars rows={loaderData.reports.householdSizes} />
            </section>
          </div>
        </Panel>

        <Panel title="Group memberships (top 10)" icon={RectangleGroupIcon}>
          <p className="mb-3 text-xs leading-5 text-slate-500">
            Current assignments to non-archived members, ranked by group.
          </p>
          {loaderData.reports.groupMemberships.length ? (
            <ul className="divide-y divide-slate-100">
              {loaderData.reports.groupMemberships.map((group) => (
                <li key={group.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium text-slate-700">{group.name}</span>
                  <span className="tabular-nums text-slate-500">{group.member_count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={RectangleGroupIcon}>No groups have been created yet.</EmptyState>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <QuickLink to="/admin/members" title="Members" description="Create and maintain member profiles and relationships." />
        <QuickLink to="/admin/households" title="Households" description="Maintain household details and connect members." />
        <QuickLink to="/admin/groups" title="Groups" description="Organise members into committees, contribution lists and working groups." />
      </div>

      <Panel title="Recently added members" icon={ClockIcon}>
        {loaderData.recentMembers.length ? (
          <ul className="divide-y divide-slate-100">
            {loaderData.recentMembers.map((member) => (
              <li key={member.id} className="px-4 py-3 sm:px-5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/members/${member.id}`} className="font-medium text-slate-900 hover:text-brand">
                    {member.full_name}
                  </Link>
                  <span className="mt-0.5 text-xs text-slate-500 capitalize">{member.status}</span>
                </div>
                <time className="text-xs tabular-nums text-slate-500" dateTime={member.created_at}>
                  {formatDateTime(member.created_at)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={UsersIcon}>No members have been added yet.</EmptyState>
        )}
      </Panel>
      <Panel title="Building ORBIT">
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Member profile edits are recorded in a change history, while household, group, and person-to-person links keep
          their effective dates. This dashboard summarizes status, age, household size, and group membership; documents,
          approvals, and more detailed reporting remain future work.
        </p>
      </Panel>
    </div>
  );
}

function ReportBars({ rows }: { rows: { label: string; count: number }[] }) {
  const maxCount = Math.max(0, ...rows.map((row) => row.count));
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-600">{row.label}</span>
            <span className="font-semibold tabular-nums text-slate-900">{row.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${maxCount === 0 ? 0 : (row.count / maxCount) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function QuickLink({ to, title, description }: { to: string; title: string; description: string }) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-slate-200/80 bg-white/90 p-5 transition hover:border-brand-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <ArrowRightIcon className="size-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden="true" />
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
      <span className={buttonClass("secondary", "sm", "mt-5")}>Open section</span>
    </Link>
  );
}
