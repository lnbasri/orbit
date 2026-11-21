import { Form, Link } from "react-router";
import { MagnifyingGlassIcon, PlusIcon, UsersIcon } from "@heroicons/react/24/outline";

import type { Route } from "./+types/members";
import { EmptyState, PageHeader, Panel } from "~/components/admin";
import { listMembers } from "~/lib/members.server";
import { getAppEnv } from "~/lib/env.server";
import { buttonClass } from "~/components/ui";

export function meta() {
  return [{ title: "Members — ORBIT" }, { name: "robots", content: "noindex" }];
}

export async function loader({ url }: Route.LoaderArgs) {
  const q = url.searchParams.get("q") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  return { q, status, ...(await listMembers(getAppEnv().DB, { q, status, page })) };
}

const STATUS_LABEL: Record<string, string> = { active: "Active", inactive: "Inactive", moved: "Moved", deceased: "Deceased" };
const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  inactive: "bg-slate-100 text-slate-700 ring-slate-500/20",
  moved: "bg-sky-50 text-sky-800 ring-sky-600/20",
  deceased: "bg-red-50 text-red-800 ring-red-600/20",
};

export default function Members({ loaderData }: Route.ComponentProps) {
  const { members, count, page, pageCount, q, status } = loaderData;
  return (
    <div>
      <PageHeader
        eyebrow="Directory"
        title={<>Members <span className="text-slate-400 tabular-nums">({count})</span></>}
        description="Member profiles, current status, and links to their household and group records."
        actions={<Link to="/admin/members/new" className={buttonClass("primary", "md")}><PlusIcon className="size-4" aria-hidden="true" /> Add member</Link>}
      />
      <Panel flush>
        <Form method="get" className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end sm:px-5">
          <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">
            Search members
            <span className="relative mt-1.5 block">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input name="q" type="search" defaultValue={q} placeholder="Name, email, or phone" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15" />
            </span>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Status
            <select name="status" defaultValue={status} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 sm:w-44">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="moved">Moved</option>
              <option value="deceased">Deceased</option>
            </select>
          </label>
          <button type="submit" className={buttonClass("secondary", "md")}>Filter</button>
        </Form>
        {members.length ? (
          <>
            <ul className="divide-y divide-slate-100">
              {members.map((member) => (
                <li key={member.id}>
                  <Link to={`/admin/members/${member.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 transition hover:bg-slate-50 sm:px-5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand" aria-hidden="true">
                      {member.full_name.trim().slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-48 flex-1">
                      <span className="block font-semibold text-slate-900">{member.preferred_name || member.full_name}</span>
                      <span className="mt-0.5 block text-sm text-slate-500">{member.email || member.phone || "No contact details"}</span>
                    </span>
                    <span className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[member.status]}`}>
                      {STATUS_LABEL[member.status]}
                    </span>
                    {member.joined_on ? <time className="text-xs tabular-nums text-slate-500" dateTime={member.joined_on}>Joined {member.joined_on}</time> : null}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:px-5">
              <span>{count} total members</span>
              <div className="flex items-center gap-2">
                {page > 1 ? <Link className={buttonClass("secondary", "sm")} to={pageHref(q, status, page - 1)}>Previous</Link> : null}
                <span>Page {page} of {pageCount}</span>
                {page < pageCount ? <Link className={buttonClass("secondary", "sm")} to={pageHref(q, status, page + 1)}>Next</Link> : null}
              </div>
            </div>
          </>
        ) : (
          <EmptyState icon={UsersIcon}>{q || status ? "No members match these filters." : "No members yet. Add the first member to begin."}</EmptyState>
        )}
      </Panel>
    </div>
  );
}

function pageHref(q: string, status: string, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  params.set("page", String(page));
  return `/admin/members?${params}`;
}
