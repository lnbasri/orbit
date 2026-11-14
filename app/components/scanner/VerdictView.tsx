import { Checkbox } from "@headlessui/react";
import {
  CheckCircleIcon,
  CheckIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  LifebuoyIcon,
  ShieldExclamationIcon,
  UserGroupIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";

import { buttonClass, Spinner } from "~/components/ui";
import type { GroupMember, LookupResult } from "~/lib/checkin.server";
import { reasonActionKey, reasonTitleKey, type TextKey } from "~/lib/scanner-i18n";
import { clock, useT } from "./lang";

export type DenyChoice = "ticket_problem" | "behaviour" | "other";

const HERO = {
  green: { bg: "bg-emerald-600 text-white", icon: CheckCircleIcon, key: "vGreen" },
  amber: { bg: "bg-amber-400 text-slate-950", icon: ExclamationTriangleIcon, key: "vAmber" },
  red: { bg: "bg-red-600 text-white", icon: XCircleIcon, key: "vRed" },
} as const;

/** Whole-screen verdict for one scanned ticket: colour + icon + words, one clear action at the bottom. */
export function VerdictView({
  result,
  isLead,
  busy,
  onAdmit,
  onDeny,
  onClose,
  onHelp,
}: {
  result: LookupResult;
  isLead: boolean;
  busy: boolean;
  onAdmit: (ids: string[], override: boolean) => void;
  onDeny: (reason: DenyChoice) => void;
  onClose: () => void;
  onHelp: () => void;
}) {
  const T = useT();
  const soft = !!result.soft;
  const hero = soft ? { bg: "bg-slate-700 text-white", icon: CheckCircleIcon, key: "softTitle" } : HERO[result.verdict];
  const Icon = hero.icon;
  const group = result.group ?? [];
  const ready = useMemo(() => group.filter((m) => m.state === "ready"), [group]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(result.person && ready.some((m) => m.id === result.person!.id) ? [result.person.id] : []));
  const [denying, setDenying] = useState(false);

  const title = soft
    ? T("softTitle")
    : result.verdict === "green"
      ? T("vGreen")
      : result.reason
        ? T(reasonTitleKey(result.reason))
        : T(hero.key as TextKey);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allReadySelected = ready.length > 0 && ready.every((m) => selected.has(m.id));
  const canAdmit = result.verdict === "green" || (result.verdict === "amber" && result.overridable && isLead);

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      {result.practice ? (
        <div className="bg-slate-900 px-4 py-2 text-center text-[11px] font-semibold tracking-[0.12em] text-amber-300 uppercase">{T("practiceBanner")}</div>
      ) : null}
      <header className={`${hero.bg} px-6 pt-8 pb-7`} role="status" aria-live="assertive">
        <div className="mx-auto flex max-w-md items-center gap-4">
          <Icon className="size-14 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <div className="min-w-0">
            {result.verdict !== "green" && !soft ? (
              <p className="text-[11px] font-semibold tracking-[0.14em] uppercase opacity-80">{result.verdict === "amber" ? T("vAmber") : T("vRed")}</p>
            ) : null}
            <h1 className="mt-0.5 text-2xl leading-tight font-bold">{title}</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 px-6 pt-6 pb-48">
        {result.person ? (
          <section>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">{T("personAge")}</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-3xl leading-tight font-bold break-words text-slate-900">{result.person.name}</p>
              <span className="rounded-md bg-brand-50 px-2 py-0.5 text-sm font-semibold text-brand ring-1 ring-brand-200 ring-inset">
                {T(`age_${result.person.ageGroup}` as TextKey)}
              </span>
            </div>
          </section>
        ) : null}

        {result.reason ? (
          <section className="mt-5 space-y-3">
            {soft ? null : <p className="text-[15px] leading-relaxed text-slate-700">{T(reasonActionKey(result.reason))}</p>}
            {result.reason === "already_in" && result.first ? (
              <FirstScan first={result.first} soft={!!result.soft} />
            ) : null}
            {!soft && result.verdict === "red" && result.reason !== "own_ticket" && result.reason !== "checkin_off" ? (
              <div className="border-l-2 border-slate-300 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">{T("sayTitle")}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-700">{T("sayGuest")}</p>
              </div>
            ) : null}
          </section>
        ) : null}

        {group.length > 1 ? (
          <section className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <UserGroupIcon className="size-4 text-brand" aria-hidden="true" />
                {T("group")}
              </h2>
              <p className="text-xs text-slate-500">{T("groupCount", { inside: result.inside ?? 0, total: result.total ?? group.length })}</p>
            </div>
            <ul className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
              {group.map((m) => (
                <MemberRow key={m.id} member={m} current={m.id === result.person?.id} checked={selected.has(m.id)} disabled={!canAdmit || busy} onToggle={() => toggle(m.id)} />
              ))}
            </ul>
            {canAdmit && ready.length > 1 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelected(allReadySelected ? new Set(result.person ? [result.person.id] : []) : new Set(ready.map((m) => m.id)))}
                className={buttonClass("ghost", "sm", "mt-2 -ml-3")}
              >
                {T("selectAll")}
              </button>
            ) : null}
          </section>
        ) : null}

        {result.verdict !== "green" && !soft ? (
          <p className="mt-8 text-xs leading-relaxed text-slate-500">{T("supportFooter")}</p>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto max-w-md space-y-2 px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {denying ? (
            <DenyChoices busy={busy} onPick={onDeny} onCancel={() => setDenying(false)} />
          ) : (
            <>
              {canAdmit ? (
                <button
                  type="button"
                  disabled={busy || selected.size === 0}
                  onClick={() => onAdmit([...selected], result.verdict === "amber")}
                  className={buttonClass(result.verdict === "green" ? "success" : "primary", "lg", "w-full !min-h-14 !text-base")}
                >
                  {busy ? <Spinner className="size-5" /> : <CheckIcon className="size-5" aria-hidden="true" />}
                  {busy ? T("admitting") : result.verdict === "amber" ? T("override") : selected.size > 1 ? T("confirmN", { n: selected.size }) : T("confirm")}
                </button>
              ) : null}
              <div className="flex gap-2">
                {!soft && (result.verdict === "red" || (result.verdict === "amber" && !canAdmit)) ? (
                  <button type="button" onClick={onHelp} className={buttonClass("secondary", "md", "flex-1")}>
                    <LifebuoyIcon className="size-4" aria-hidden="true" />
                    {T("helpButton")}
                  </button>
                ) : null}
                {canAdmit && result.verdict === "green" ? (
                  <button type="button" disabled={busy} onClick={() => setDenying(true)} className={buttonClass("secondary", "md", "flex-1")}>
                    <XMarkIcon className="size-4" aria-hidden="true" />
                    {T("deny")}
                  </button>
                ) : null}
                <button type="button" disabled={busy} onClick={onClose} className={buttonClass(canAdmit ? "ghost" : "primary", "md", "flex-1")}>
                  {canAdmit ? T("close") : T("nextScan")}
                  {!canAdmit ? <ChevronRightIcon className="size-4" aria-hidden="true" /> : null}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FirstScan({ first, soft }: { first: { at: string; by: string | null; device: string | null }; soft: boolean }) {
  const T = useT();
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(first.at)) / 1000));
  const ago = seconds < 90 ? T("secondsAgo", { n: seconds }) : T("minutesAgo", { n: Math.round(seconds / 60) });
  return (
    <div className="flex gap-3 border-l-2 border-red-600 bg-red-50/70 px-4 py-3 text-sm text-red-950">
      <ShieldExclamationIcon className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold">{soft ? T("soft") : T("firstScan", { time: clock(first.at) })}</p>
        {!soft ? (
          <p className="text-red-900/80">
            {first.by ? `${T("firstBy", { by: first.by })} · ` : ""}
            {ago}
            {first.device ? ` · ${first.device}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  current,
  checked,
  disabled,
  onToggle,
}: {
  member: GroupMember;
  current: boolean;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const T = useT();
  const inside = member.state === "inside";
  const selectable = member.state === "ready" && !disabled;
  return (
    <li className="flex items-center gap-3 py-3">
      {inside ? (
        <span className="flex size-6 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 ring-inset" aria-hidden="true">
          <CheckIcon className="size-4" />
        </span>
      ) : (
        <Checkbox
          checked={checked}
          onChange={onToggle}
          disabled={!selectable}
          aria-label={member.name}
          className="group flex size-6 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white transition-colors data-[checked]:border-brand data-[checked]:bg-brand data-[disabled]:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          <CheckIcon className="size-4 text-white opacity-0 group-data-[checked]:opacity-100" aria-hidden="true" />
        </Checkbox>
      )}
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[15px] ${current ? "font-semibold text-slate-900" : "text-slate-700"}`}>{member.name}</p>
        <p className="text-xs text-slate-500">
          {T(`age_${member.ageGroup}` as TextKey)}
          {inside ? ` · ${T("stateInside")}${member.insideAt ? ` ${clock(member.insideAt)}` : ""}` : ""}
        </p>
      </div>
    </li>
  );
}

function DenyChoices({ busy, onPick, onCancel }: { busy: boolean; onPick: (r: DenyChoice) => void; onCancel: () => void }) {
  const T = useT();
  const choices: [DenyChoice, TextKey][] = [
    ["ticket_problem", "denyTicket"],
    ["behaviour", "denyBehaviour"],
    ["other", "denyOther"],
  ];
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">{T("denyTitle")}</p>
      {choices.map(([value, label]) => (
        <button key={value} type="button" disabled={busy} onClick={() => onPick(value)} className={buttonClass("secondary", "md", "w-full !justify-start")}>
          {T(label)}
        </button>
      ))}
      <button type="button" onClick={onCancel} className={buttonClass("ghost", "sm", "w-full")}>
        {T("cancel")}
      </button>
    </div>
  );
}
