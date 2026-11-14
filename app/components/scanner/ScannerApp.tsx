import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import {
  ArrowRightOnRectangleIcon,
  ArrowUturnLeftIcon,
  BeakerIcon,
  BookOpenIcon,
  Bars3Icon,
  ChartBarIcon,
  CheckCircleIcon,
  CheckIcon,
  DevicePhoneMobileIcon,
  ExclamationTriangleIcon,
  LifebuoyIcon,
  PlayIcon,
  QrCodeIcon,
  SignalSlashIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  UserGroupIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { Form } from "react-router";

import { Backdrop, buttonClass, Callout, Logo, Spinner } from "~/components/ui";
import { TICKET_TOKEN_PATTERN } from "~/lib/ids";
import type { AdmitItem, LookupResult } from "~/lib/checkin.server";
import type { EscalationContact } from "~/lib/scanners.server";
import { api, isStandalone, newRequestId, readSound, SCANNER_APP_VERSION, writeSound } from "~/lib/scanner-client";
import type { TextKey } from "~/lib/scanner-i18n";
import { feedback, unlockAudio } from "./feedback";
import { HelpSheet } from "./Help";
import { HowTo, InstallGuide } from "./Info";
import { LangSwitch, useT } from "./lang";
import { QrCamera, type CameraState } from "./QrCamera";
import { SelfTest } from "./SelfTest";
import { MyStatsScreen, TeamScreen } from "./Stats";
import { VerdictView, type DenyChoice } from "./VerdictView";

type Screen = "scan" | "selftest" | "howto" | "install" | "mystats" | "team";
type View =
  | { kind: "scanning" }
  | { kind: "checking" }
  | { kind: "verdict"; code: string; result: LookupResult; notice?: string }
  | { kind: "done"; name: string; count: number; ids: string[]; practice: boolean };

interface LeadSummary {
  working: number;
  total: number;
  problem: number;
  quiet: number;
  remainingRegistrations: number;
  remainingPeople: number;
  etaMinutes: number | null;
}

interface PulseResponse {
  inside: number;
  expected: number;
  mine: { people: number; registrations: number };
  lead: LeadSummary | null;
}

interface Props {
  scanner: { name: string | null; email: string; role: "scanner" | "lead" };
  contacts: Pick<EscalationContact, "id" | "level" | "name" | "role_label" | "phone" | "note">[];
}

/** The check-in app: camera, verdict, one-tap confirm, undo, help, self-test and practice. All decisions come from the server. */
export function ScannerApp({ scanner, contacts }: Props) {
  const T = useT();
  const [screen, setScreen] = useState<Screen>("scan");
  const [view, setView] = useState<View>({ kind: "scanning" });
  const [started, setStarted] = useState(false);
  const [practice, setPractice] = useState(false);
  const [online, setOnline] = useState(true);
  const [sound, setSound] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ inside: number; expected: number } | null>(null);
  const [mine, setMine] = useState<{ people: number; registrations: number } | null>(null);
  const [lead, setLead] = useState<LeadSummary | null>(null);
  const [undo, setUndo] = useState<{ ids: string[]; practice: boolean } | null>(null);
  const [camera, setCamera] = useState<CameraState>("idle");
  const [standalone, setStandalone] = useState(false);
  const verdictRequest = useRef<{ code: string; id: string } | null>(null);
  // The guest's QR often stays in front of the camera after the tap: ignore that code for a few seconds so it is not read again.
  const justAdmitted = useRef<{ code: string; until: number } | null>(null);
  const lastEscalationRef = useRef<{ participantId: string | null; reason: string | null }>({ participantId: null, reason: null });

  const isLead = scanner.role === "lead";
  const label = scanner.name?.trim() || scanner.email;

  // Client-only setup (kept out of the first render so server and browser markup agree).
  useEffect(() => {
    setSound(readSound());
    setStandalone(isStandalone());
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/scan/sw.js", { scope: "/scan" }).catch(() => undefined);
    }
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const handleApiFailure = useCallback(
    (kind: "offline" | "session" | "rate" | "server" | "bad") => {
      if (kind === "session") {
        window.location.href = "/scan/login";
        return;
      }
      setError(kind === "offline" ? T("errNetwork") : kind === "rate" ? T("errRate") : kind === "server" ? T("errServer") : T("errGeneric"));
      if (kind === "offline") setOnline(false);
    },
    [T],
  );

  // Heartbeat every 20 s: tells the server this phone is alive and what it is doing (so a team lead can see which phones work),
  // and brings back the counters. A failed heartbeat is also how the app notices it lost the connection.
  const pulseState: "scanning" | "idle" | "camera_problem" =
    started && (camera === "denied" || camera === "error" || camera === "unsupported")
      ? "camera_problem"
      : screen === "scan" && started && camera === "running"
        ? "scanning"
        : "idle";
  useEffect(() => {
    let live = true;
    const send = async () => {
      const res = await api<PulseResponse>("pulse", { state: document.hidden ? "background" : pulseState });
      if (!live) return;
      if (res.ok) {
        setOnline(true);
        setStats({ inside: res.data.inside, expected: res.data.expected });
        setMine(res.data.mine);
        setLead(res.data.lead);
      } else if (res.kind === "session") window.location.href = "/scan/login";
      else if (res.kind === "offline") setOnline(false);
    };
    void send();
    const id = setInterval(send, 20_000);
    const onVisibility = () => {
      if (document.hidden) {
        // Tell the server we are leaving: the lead sees "inactive" at once instead of waiting for the silence.
        navigator.sendBeacon?.("/scan/api/pulse", new Blob([JSON.stringify({ state: "background" })], { type: "application/json" }));
      } else void send();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pulseState, view.kind]);

  // Undo toast disappears after 10 seconds (the server allows 2 minutes).
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(id);
  }, [undo]);

  async function lookup(code: string) {
    setError(null);
    setView({ kind: "checking" });
    const res = await api<{ result: LookupResult }>("lookup", { code });
    if (!res.ok) {
      handleApiFailure(res.kind);
      setView({ kind: "scanning" });
      feedback("bad", sound);
      return;
    }
    const result = res.data.result;
    feedback(result.verdict === "green" ? "ok" : result.verdict === "amber" ? "warn" : "bad", sound);
    lastEscalationRef.current = { participantId: result.person?.id ?? null, reason: result.reason };
    verdictRequest.current = { code, id: newRequestId() };
    setView({ kind: "verdict", code, result });
  }

  function onCode(raw: string) {
    if (view.kind !== "scanning" || busy) return;
    const code = raw.trim().toUpperCase();
    if (justAdmitted.current && justAdmitted.current.code === code && Date.now() < justAdmitted.current.until) return;
    const isPracticeCode = /^PPME-LATIHAN-0[1-9]$/.test(code);
    if (!isPracticeCode && !TICKET_TOKEN_PATTERN.test(code)) {
      setError(T("errBadQr"));
      feedback("bad", sound);
      return;
    }
    if (practice && !isPracticeCode) {
      setError(T("practiceOnly"));
      return;
    }
    void lookup(code);
  }

  async function admit(ids: string[], override: boolean) {
    if (view.kind !== "verdict" || !verdictRequest.current) return;
    setBusy(true);
    const res = await api<{ items: AdmitItem[] }>("admit", {
      participantIds: ids,
      requestId: verdictRequest.current.id,
      override,
    });
    setBusy(false);
    if (!res.ok) {
      handleApiFailure(res.kind);
      return;
    }
    const items = res.data.items;
    const admitted = items.filter((i) => i.status === "admitted");
    if (admitted.length === items.length) {
      feedback("ok", sound);
      const name = view.result.person?.name ?? "";
      setView({ kind: "done", name, count: admitted.length, ids: admitted.map((i) => i.id), practice: !!view.result.practice });
      setUndo({ ids: admitted.map((i) => i.id), practice: !!view.result.practice });
      justAdmitted.current = { code: view.code, until: Date.now() + 8000 };
      setTimeout(() => setView((v) => (v.kind === "done" ? { kind: "scanning" } : v)), 1300);
      return;
    }
    // Somebody else was faster: show the current picture.
    feedback("bad", sound);
    await lookup(view.code);
    setView((v) => (v.kind === "verdict" ? { ...v, notice: T("raceLost") } : v));
  }

  async function deny(reason: DenyChoice) {
    if (view.kind !== "verdict") return;
    setBusy(true);
    await api("deny", { participantId: view.result.person?.id ?? null, reason, requestId: newRequestId() });
    setBusy(false);
    setView({ kind: "scanning" });
    setNotice(T("denyDone"));
  }

  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(id);
  }, [notice]);

  async function doUndo() {
    if (!undo) return;
    const ids = undo.ids;
    setUndo(null);
    let failed = false;
    for (const id of ids) {
      const res = await api<{ ok: boolean }>("undo", { participantId: id });
      if (!res.ok) {
        failed = true;
        if (res.kind === "bad") break;
        handleApiFailure(res.kind);
        return;
      }
    }
    setNotice(failed ? T("undoNotAllowed") : T("undone"));
  }

  function escalate(level: 1 | 2 | 3) {
    void api("escalate", { level, participantId: lastEscalationRef.current.participantId, reason: lastEscalationRef.current.reason });
  }

  function toggleSound() {
    const next = !sound;
    setSound(next);
    writeSound(next);
    if (next) {
      unlockAudio();
      feedback("ok", true);
    }
  }

  /** Undo / notice toast. Shown on the scan screen (bottom) and over the verdict screen (top), so Undo never disappears. */
  const toastEl = (pos: "top" | "bottom") =>
    undo || notice ? (
      <div
        className={`pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4 ${pos === "bottom" ? "bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))]" : "top-0 pt-[max(0.75rem,env(safe-area-inset-top))]"}`}
      >
        <div className="pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-white shadow-lg" role="status">
          <span className="flex items-center gap-2">
            <CheckIcon className="size-4 text-emerald-400" aria-hidden="true" />
            {undo ? (undo.ids.length > 1 ? T("admittedN", { n: undo.ids.length }) : T("admitted")) : notice}
          </span>
          {undo ? (
            <button type="button" onClick={doUndo} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-white/30 px-3 font-semibold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <ArrowUturnLeftIcon className="size-4" aria-hidden="true" />
              {T("undo")}
            </button>
          ) : null}
        </div>
      </div>
    ) : null;

  // -------------------------------------------------------------- screens

  if (screen === "selftest") return <SelfTest onBack={() => setScreen("scan")} />;
  if (screen === "howto") return <HowTo onBack={() => setScreen("scan")} />;
  if (screen === "install") return <InstallGuide onBack={() => setScreen("scan")} standalone={standalone} />;
  if (screen === "mystats") return <MyStatsScreen onBack={() => setScreen("scan")} />;
  if (screen === "team" && isLead) return <TeamScreen onBack={() => setScreen("scan")} />;

  if (view.kind === "verdict") {
    return (
      <>
        {toastEl("top")}
        {view.notice ? (
          <div className="fixed inset-x-0 top-0 z-20 bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-white">{view.notice}</div>
        ) : null}
        <VerdictView
          key={view.code + view.result.verdict + (view.result.inside ?? 0)}
          result={view.result}
          isLead={isLead}
          busy={busy}
          onAdmit={admit}
          onDeny={deny}
          onClose={() => setView({ kind: "scanning" })}
          onHelp={() => setHelpOpen(true)}
        />
        <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} contacts={contacts} onEscalate={escalate} />
      </>
    );
  }

  if (view.kind === "done") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-emerald-600 px-8 text-center text-white" role="status" aria-live="assertive">
        <CheckCircleIcon className="size-24" strokeWidth={1.25} aria-hidden="true" />
        <p className="mt-4 text-2xl font-bold">{view.count > 1 ? T("admittedN", { n: view.count }) : T("admitted")}</p>
        {view.name ? <p className="mt-1 text-lg opacity-90">{view.name}</p> : null}
      </div>
    );
  }

  const scanning = view.kind === "scanning" && started;

  return (
    <Backdrop>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
        {practice ? (
          <div className="flex items-center justify-between gap-3 bg-slate-900 px-4 py-2 text-[11px] font-semibold tracking-[0.1em] text-amber-300 uppercase">
            <span className="flex items-center gap-2">
              <BeakerIcon className="size-4" aria-hidden="true" />
              {T("practiceBanner")}
            </span>
            <button type="button" onClick={() => setPractice(false)} className="rounded-sm px-2 py-1 text-white underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              {T("practiceExit")}
            </button>
          </div>
        ) : null}

        <header className="flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white/85 px-4 py-3 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-3">
            <Logo className="h-8 w-auto" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-brand uppercase">{T("appName")}</p>
              <p className="truncate text-xs text-slate-500">{label}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LangSwitch />
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label={T("menu")}
              className="flex size-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Bars3Icon className="size-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        {!online ? (
          <div className="flex items-center gap-2 bg-red-600 px-4 py-2 text-sm font-medium text-white" role="alert">
            <SignalSlashIcon className="size-4 shrink-0" aria-hidden="true" />
            {T("noConnection")}
          </div>
        ) : null}

        <main className="flex flex-1 flex-col gap-4 p-4">
          <section className="relative">
            {started ? (
              <QrCamera active={scanning || view.kind === "checking"} onCode={onCode} onState={setCamera} className="aspect-[3/4] w-full rounded-lg border border-slate-300" />
            ) : (
              <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-5 rounded-lg border border-slate-200/80 bg-white/85 px-8 text-center backdrop-blur-md">
                <span className="flex size-16 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-brand">
                  <QrCodeIcon className="size-8" aria-hidden="true" />
                </span>
                <p className="text-[15px] leading-relaxed text-slate-600">{T("scanHint")}</p>
                <button
                  type="button"
                  onClick={() => {
                    unlockAudio();
                    setStarted(true);
                  }}
                  className={buttonClass("primary", "lg", "w-full")}
                >
                  <PlayIcon className="size-5" aria-hidden="true" />
                  {T("startScan")}
                </button>
              </div>
            )}
            {view.kind === "checking" ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-slate-950/70 text-sm font-medium text-white">
                <Spinner className="size-5" />
                {T("checking")}
              </div>
            ) : null}
          </section>

          {started && camera === "running" && view.kind === "scanning" ? (
            <p className="text-center text-sm text-slate-500">{T("scanHint")}</p>
          ) : null}

          {error ? (
            <Callout tone="danger" icon={ExclamationTriangleIcon} role="alert">
              <p className="flex items-start justify-between gap-3">
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label={T("close")} className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-red-700 hover:bg-red-100">
                  <XMarkIcon className="size-4" aria-hidden="true" />
                </button>
              </p>
            </Callout>
          ) : null}

          {isLead && lead ? (
            <button
              type="button"
              onClick={() => setScreen("team")}
              className={`mt-auto flex w-full items-center gap-3 border px-3 py-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                lead.problem > 0 ? "border-red-300 bg-red-50/70 text-red-900" : lead.quiet > 0 ? "border-amber-300 bg-amber-50/70 text-amber-950" : "border-slate-200 bg-white/85 text-slate-700"
              }`}
            >
              <UserGroupIcon className="size-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 font-medium">
                {lead.remainingRegistrations === 0
                  ? T("leadStripDone", { working: lead.working, total: lead.total })
                  : lead.etaMinutes === null
                    ? T("leadStripNoEta", { working: lead.working, total: lead.total, regs: lead.remainingRegistrations })
                    : T("leadStrip", { working: lead.working, total: lead.total, regs: lead.remainingRegistrations, eta: lead.etaMinutes })}
              </span>
            </button>
          ) : null}

          <div className={`${isLead && lead ? "" : "mt-auto "}flex items-center justify-between gap-3 border-t border-slate-200/80 pt-3 text-sm`}>
            <div>
              <p className="font-medium text-slate-700 tabular-nums">{stats ? T("insideCount", { inside: stats.inside, expected: stats.expected }) : " "}</p>
              {mine && mine.people > 0 ? <p className="text-xs text-slate-500 tabular-nums">{T("myCountLine", { n: mine.people })}</p> : null}
            </div>
            <button type="button" onClick={() => setHelpOpen(true)} className={buttonClass("ghost", "sm", "-mr-2")}>
              <LifebuoyIcon className="size-4" aria-hidden="true" />
              {T("helpButton")}
            </button>
          </div>
        </main>

        {toastEl("bottom")}
      </div>

      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        label={label}
        isLead={isLead}
        sound={sound}
        practice={practice}
        onSound={toggleSound}
        go={(s) => {
          setMenuOpen(false);
          setScreen(s);
        }}
        onPractice={() => {
          setMenuOpen(false);
          setPractice(true);
          setStarted(true);
          unlockAudio();
        }}
        onContacts={() => {
          setMenuOpen(false);
          setHelpOpen(true);
        }}
      />
      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} contacts={contacts} onEscalate={escalate} />
    </Backdrop>
  );
}

function Menu({
  open,
  onClose,
  label,
  isLead,
  sound,
  practice,
  onSound,
  go,
  onPractice,
  onContacts,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  isLead: boolean;
  sound: boolean;
  practice: boolean;
  onSound: () => void;
  go: (s: Screen) => void;
  onPractice: () => void;
  onContacts: () => void;
}) {
  const T = useT();
  const items: { key: TextKey; icon: typeof CheckIcon; onClick: () => void; hint?: string }[] = [
    { key: "mMyStats", icon: ChartBarIcon, onClick: () => go("mystats") },
    ...(isLead ? [{ key: "mTeam" as TextKey, icon: UserGroupIcon, onClick: () => go("team") }] : []),
    { key: "mSelftest", icon: WrenchScrewdriverIcon, onClick: () => go("selftest") },
    { key: "mPractice", icon: BeakerIcon, onClick: onPractice },
    { key: "mHowto", icon: BookOpenIcon, onClick: () => go("howto") },
    { key: "mContacts", icon: LifebuoyIcon, onClick: onContacts },
    { key: "mInstall", icon: DevicePhoneMobileIcon, onClick: () => go("install") },
  ];
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-slate-950/50 transition-opacity duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex justify-end">
        <DialogPanel transition className="flex h-full w-full max-w-xs flex-col border-l border-slate-200 bg-white shadow-xl transition duration-200 data-[closed]:translate-x-6 data-[closed]:opacity-0">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">{T("signedInAs")}</p>
              <p className="truncate text-sm font-semibold text-slate-900">{label}</p>
              <p className="text-xs text-brand">{isLead ? T("roleLead") : T("roleScanner")}</p>
            </div>
            <button type="button" onClick={onClose} aria-label={T("close")} className="flex size-10 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <XMarkIcon className="size-5" aria-hidden="true" />
            </button>
          </div>
          <nav className="flex-1 divide-y divide-slate-100 overflow-y-auto">
            {items.map(({ key, icon: Icon, onClick }) => (
              <button key={key} type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15px] font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
                <Icon className="size-5 text-brand" aria-hidden="true" />
                {T(key)}
              </button>
            ))}
            <button type="button" onClick={onSound} className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15px] font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
              {sound ? <SpeakerWaveIcon className="size-5 text-brand" aria-hidden="true" /> : <SpeakerXMarkIcon className="size-5 text-slate-400" aria-hidden="true" />}
              {sound ? T("mSoundOn") : T("mSoundOff")}
            </button>
            <Form method="post" action="/scan/logout">
              <button type="submit" className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15px] font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
                <ArrowRightOnRectangleIcon className="size-5 text-slate-500" aria-hidden="true" />
                {T("mLogout")}
              </button>
            </Form>
          </nav>
          <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-400">{T("mVersion", { version: SCANNER_APP_VERSION })}</p>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
