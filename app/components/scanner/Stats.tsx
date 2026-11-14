import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  PhoneIcon,
  QueueListIcon,
  ShieldCheckIcon,
  SignalIcon,
  SignalSlashIcon,
  UserGroupIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";

import { Callout, Eyebrow } from "~/components/ui";
import type { MyStats, TeamMember, TeamOverview } from "~/lib/checkin-insights.server";
import { api } from "~/lib/scanner-client";
import type { TextKey } from "~/lib/scanner-i18n";
import type { Presence } from "~/lib/scanner-presence";
import { ScreenFrame } from "./Info";
import { clock, useT } from "./lang";

/** Indonesian and Dutch both write a decimal comma. */
const num = (n: number) => String(n).replace(".", ",");

function useLive<T>(op: string, everyMs: number): { data: T | null; error: boolean; reload: () => void; at: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await api<T & { now?: string }>(op);
    if (res.ok) {
      setData(res.data as T);
      setAt(new Date().toISOString());
      setError(false);
    } else if (res.kind === "session") window.location.href = "/scan/login";
    else setError(true);
  }, [op]);
  useEffect(() => {
    void load();
    const id = setInterval(load, everyMs);
    return () => clearInterval(id);
  }, [load, everyMs]);
  return { data, error, reload: load, at };
}

function Tile({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: typeof UsersIcon }) {
  return (
    <div className="bg-white px-4 py-4">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
        <Icon className="size-4 text-slate-400" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

const ConnectionNote = () => {
  const T = useT();
  return (
    <Callout tone="danger" icon={SignalSlashIcon} role="alert">
      {T("errNetwork")}
    </Callout>
  );
};

// ------------------------------------------------------------------ own statistics

export function MyStatsScreen({ onBack }: { onBack: () => void }) {
  const T = useT();
  const { data, error } = useLive<{ stats: MyStats }>("me", 30_000);
  const s = data?.stats;
  const max = Math.max(1, ...(s?.buckets.map((b) => b.n) ?? [1]));
  return (
    <ScreenFrame title={T("msTitle")} onBack={onBack}>
      <p className="text-[15px] leading-relaxed text-slate-600">{T("msIntro")}</p>
      {error && !s ? <ConnectionNote /> : null}
      {s ? (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
            <Tile label={T("msPeople")} value={String(s.people)} icon={UsersIcon} />
            <Tile label={T("msRegistrations")} value={String(s.registrations)} icon={QueueListIcon} />
            <Tile label={T("msTypical")} value={s.typicalMinutes === null ? "–" : T("msTypicalValue", { n: num(s.typicalMinutes) })} icon={ClockIcon} />
            <Tile label={T("msCaught")} value={String(s.caught)} icon={ShieldCheckIcon} />
          </div>

          {s.people === 0 ? (
            <p className="border-l-2 border-brand bg-brand-50/60 px-4 py-3 text-sm leading-relaxed text-slate-700">{T("msEmpty")}</p>
          ) : (
            <>
              <section>
                <Eyebrow>{T("msChart")}</Eyebrow>
                <div className="mt-3 flex h-28 items-end gap-1.5 border-b border-slate-200" role="img" aria-label={T("msChart")}>
                  {s.buckets.map((b) => (
                    <div key={b.start} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-[10px] font-medium text-slate-500 tabular-nums">{b.n > 0 ? b.n : ""}</span>
                      <div className={`w-full rounded-t-sm ${b.n > 0 ? "bg-brand" : "bg-slate-200"}`} style={{ height: `${Math.max(4, Math.round((b.n / max) * 80))}%` }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-slate-400 tabular-nums">
                  <span>{clock(s.buckets[0].start)}</span>
                  <span>{clock(s.buckets[s.buckets.length - 1].start)}</span>
                </div>
              </section>

              <p className="text-sm text-slate-700">{T("msShare", { pct: Math.round(s.share * 100), total: s.teamPeople })}</p>

              <dl className="divide-y divide-slate-200 border-y border-slate-200 text-[15px]">
                {(
                  [
                    ["msFirst", s.firstAt ? clock(s.firstAt) : "–"],
                    ["msLast", s.lastAt ? clock(s.lastAt) : "–"],
                    ["msDuplicates", String(s.duplicates)],
                    ["msRefused", String(s.refused)],
                    ["msUndone", String(s.undone)],
                    ["msEscalated", String(s.escalated)],
                  ] as [TextKey, string][]
                ).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 py-3">
                    <dt className="text-slate-600">{T(k)}</dt>
                    <dd className="font-semibold text-slate-900 tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <ArrowPathIcon className="size-3.5" aria-hidden="true" />
            {T("msRefresh")}
          </p>
        </>
      ) : null}
    </ScreenFrame>
  );
}

// ------------------------------------------------------------------ team lead

const PRESENCE_STYLE: Record<Presence, { dot: string; text: string; icon: typeof SignalIcon }> = {
  online: { dot: "bg-emerald-500", text: "text-emerald-700", icon: SignalIcon },
  idle: { dot: "bg-sky-500", text: "text-sky-700", icon: SignalIcon },
  problem: { dot: "bg-red-600", text: "text-red-700", icon: WrenchScrewdriverIcon },
  away: { dot: "bg-amber-500", text: "text-amber-700", icon: ExclamationTriangleIcon },
  offline: { dot: "bg-slate-400", text: "text-slate-600", icon: SignalSlashIcon },
  signed_out: { dot: "bg-slate-300", text: "text-slate-500", icon: SignalSlashIcon },
};
/** Problems first: that is what a lead has to act on. */
const ORDER: Record<Presence, number> = { problem: 0, offline: 1, away: 2, signed_out: 3, idle: 4, online: 5 };

function ago(T: ReturnType<typeof useT>, iso: string | null, nowMs: number) {
  if (!iso) return T("tmNeverSeen");
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  return T("tmSeen", { ago: s < 90 ? T("secondsAgo", { n: s }) : T("minutesAgo", { n: Math.round(s / 60) }) });
}

export function TeamScreen({ onBack }: { onBack: () => void }) {
  const T = useT();
  const { data, error, at } = useLive<{ team: TeamOverview; now: string }>("team", 15_000);
  const team = data?.team;
  const nowMs = data ? Date.parse(data.now) : Date.now();
  const working = team ? team.members.filter((m) => m.presence === "online" || m.presence === "idle").length : 0;
  const maxPeople = Math.max(1, ...(team?.members.map((m) => m.people) ?? [1]));
  const quiet = team ? team.counts.away + team.counts.offline : 0;
  return (
    <ScreenFrame title={T("tmTitle")} onBack={onBack}>
      <p className="text-[15px] leading-relaxed text-slate-600">{T("tmIntro")}</p>
      {error && !team ? <ConnectionNote /> : null}
      {team ? (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
            <Tile label={T("tmPhones")} value={T("tmPhonesValue", { working, total: team.members.length })} icon={PhoneIcon} />
            <Tile label={T("tmInside")} value={T("tmInsideValue", { inside: team.inside, expected: team.expected })} icon={UserGroupIcon} />
          </div>

          {team.counts.problem > 0 ? (
            <Callout tone="danger" icon={WrenchScrewdriverIcon} role="alert">
              {T("tmAlertProblem", { n: team.counts.problem })}
            </Callout>
          ) : null}
          {quiet > 0 ? (
            <Callout tone="warning" icon={SignalSlashIcon} role="status">
              {T("tmAlertQuiet", { n: quiet })}
            </Callout>
          ) : null}

          <section className="border border-slate-200 bg-white px-4 py-4">
            <Eyebrow>{T("tmBacklog")}</Eyebrow>
            <p className="mt-1.5 text-lg font-semibold text-slate-900">
              {T("tmRemaining", { regs: team.backlog.remainingRegistrations, people: team.backlog.remainingPeople })}
            </p>
            <p className="mt-2 text-sm text-slate-700">
              {team.backlog.etaMinutes === 0
                ? T("tmEtaDone")
                : team.backlog.etaMinutes === null
                  ? T("tmEtaNone")
                  : T("tmEta", { n: team.backlog.etaMinutes })}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              <span className="font-medium">{T("tmPace")}:</span>{" "}
              {team.backlog.source === "measured" ? T("tmPaceMeasured", { n: num(team.backlog.perMinute) }) : T("tmPacePlanned", { n: num(team.backlog.perMinute) })}
            </p>
          </section>

          <section>
            <Eyebrow>{T("tmMembers")}</Eyebrow>
            <ul className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
              {[...team.members]
                .sort((a, b) => ORDER[a.presence] - ORDER[b.presence] || b.people - a.people)
                .map((m) => (
                  <Member key={m.id} m={m} nowMs={nowMs} maxPeople={maxPeople} T={T} />
                ))}
            </ul>
          </section>
          {at ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <ArrowPathIcon className="size-3.5" aria-hidden="true" />
              {T("tmUpdated", { time: clock(at) })}
            </p>
          ) : null}
        </>
      ) : null}
    </ScreenFrame>
  );
}

function Member({ m, nowMs, maxPeople, T }: { m: TeamMember; nowMs: number; maxPeople: number; T: ReturnType<typeof useT> }) {
  const style = PRESENCE_STYLE[m.presence];
  const hint = m.presence === "online" ? null : (`prHint_${m.presence}` as TextKey);
  return (
    <li className="py-3.5">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-[15px] font-semibold text-slate-900">{m.label}</span>
            {m.role === "lead" ? (
              <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand ring-1 ring-brand-200 ring-inset">{T("tmLeadBadge")}</span>
            ) : null}
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${style.text}`}>
              <style.icon className="size-3.5" aria-hidden="true" />
              {T(`pr_${m.presence}` as TextKey)}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {[m.device, m.presence === "signed_out" ? null : ago(T, m.lastSeenAt, nowMs), m.sessions > 1 ? T("tmSessions", { n: m.sessions }) : null].filter(Boolean).join(" · ")}
          </p>
          {hint ? <p className="mt-0.5 text-xs text-slate-600">{T(hint)}</p> : null}
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round((m.people / maxPeople) * 100)}%` }} />
            </div>
            <p className="shrink-0 text-xs font-medium text-slate-700 tabular-nums">
              {T("tmPeople", { n: m.people })} · {T("tmRegs", { n: m.registrations })}
            </p>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {[
              m.lastCheckinAt ? T("tmLast", { time: clock(m.lastCheckinAt) }) : T("tmNoCheckin"),
              m.typicalMinutes !== null ? T("tmTyped", { n: num(m.typicalMinutes) }) : null,
              m.testPassed === null ? null : m.testPassed ? T("tmTestOk") : T("tmTestNo"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {m.presence === "online" ? <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden="true" /> : null}
      </div>
    </li>
  );
}
