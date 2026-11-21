import { Link } from "react-router";
import {
  ArrowRightIcon,
  BuildingOffice2Icon,
  RectangleGroupIcon,
  UserGroupIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";

import type { Route } from "./+types/dashboard";
import { PageHeader, Panel, Stat, StatGroup } from "~/components/admin";
import { buttonClass } from "~/components/ui";
import { getAppEnv } from "~/lib/env.server";

export function meta() {
  return [{ title: "ORBIT — Organisation overview" }, { name: "robots", content: "noindex" }];
}

export async function loader() {
  const db = getAppEnv().DB;
  const [members, active, pending, households, groups] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM members WHERE archived_at IS NULL").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM members WHERE archived_at IS NULL AND status = 'active'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM members WHERE archived_at IS NULL AND status = 'pending'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM households").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM administrative_groups").first<{ count: number }>(),
  ]);
  return {
    members: members?.count ?? 0,
    activeMembers: active?.count ?? 0,
    pendingMembers: pending?.count ?? 0,
    households: households?.count ?? 0,
    groups: groups?.count ?? 0,
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
        <Stat icon={RectangleGroupIcon} label="Administrative groups" value={loaderData.groups} />
        <Stat icon={UsersIcon} label="Pending members" value={loaderData.pendingMembers} />
      </StatGroup>

      <div className="grid gap-6 md:grid-cols-3">
        <QuickLink to="/admin/members" title="Members" description="Create and maintain member profiles and relationships." />
        <QuickLink to="/admin/households" title="Households" description="Maintain household details and connect members." />
        <QuickLink to="/admin/groups" title="Administrative groups" description="Organise members into committees and working groups." />
      </div>
      <Panel title="Building ORBIT">
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Member profile edits are recorded in a change history, while household, group, and person-to-person links keep
          their effective dates. This foundation is ready to support future documents, communications, approvals, and reports.
        </p>
      </Panel>
    </div>
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
