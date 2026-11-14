import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  PlayIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";

import { buttonClass, Callout, Spinner } from "~/components/ui";
import { TICKET_TOKEN_PATTERN } from "~/lib/ids";
import { api, isStandalone, SCANNER_APP_VERSION } from "~/lib/scanner-client";
import type { TextKey } from "~/lib/scanner-i18n";
import { feedback, unlockAudio } from "./feedback";
import { ScreenFrame } from "./Info";
import { useT } from "./lang";
import { QrCamera, type CameraState } from "./QrCamera";

type Status = "pending" | "pass" | "warn" | "fail" | "skip";
const KEYS = ["browser", "installed", "permission", "camera", "decode", "network", "session", "clock", "wakelock", "sound", "offline", "language"] as const;
type Key = (typeof KEYS)[number];
type Item = { status: Status; detail?: string };

const ICON: Record<Status, { icon: typeof CheckCircleIcon; cls: string }> = {
  pass: { icon: CheckCircleIcon, cls: "text-emerald-600" },
  warn: { icon: ExclamationTriangleIcon, cls: "text-amber-500" },
  fail: { icon: XCircleIcon, cls: "text-red-600" },
  skip: { icon: MinusCircleIcon, cls: "text-slate-400" },
  pending: { icon: ClockIcon, cls: "text-slate-300" },
};

const initial = (): Record<Key, Item> => Object.fromEntries(KEYS.map((k) => [k, { status: "pending" as Status }])) as Record<Key, Item>;

/**
 * Device self-test (deliverable of the plan): every volunteer finds out days before the event whether their phone, camera,
 * permissions and mobile data work. The automatic checks run at once; the camera and the practice QR need the phone itself;
 * the sound needs one tap. The result is stored on the server so the committee sees a readiness board.
 */
export function SelfTest({ onBack }: { onBack: () => void }) {
  const T = useT();
  const [items, setItems] = useState<Record<Key, Item>>(initial);
  const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [cameraOn, setCameraOn] = useState(false);
  const decodeStart = useRef(0);

  const set = useCallback((key: Key, status: Status, detail?: string) => {
    setItems((prev) => ({ ...prev, [key]: { status, detail } }));
  }, []);

  const runAutomatic = useCallback(async () => {
    setRunning(true);
    // 1. browser + https
    const secure = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
    set("browser", secure ? "pass" : "fail");
    // 2. installed
    set("installed", isStandalone() ? "pass" : "warn");
    // 3. camera permission (Safari has no Permissions API for the camera: then the camera step decides)
    try {
      const p = await navigator.permissions?.query({ name: "camera" as PermissionName });
      set("permission", !p ? "skip" : p.state === "granted" ? "pass" : p.state === "denied" ? "fail" : "warn");
    } catch {
      set("permission", "skip");
    }
    // 6./7. network + session via the health endpoint (3 round trips), also gives the server clock
    const times: number[] = [];
    let serverNow = 0;
    let netOk = true;
    let sessionOk = true;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const res = await api<{ now: string }>("health", undefined, { timeoutMs: 6000 });
      const ms = Math.round(performance.now() - t0);
      if (res.ok) {
        times.push(ms);
        serverNow = Date.parse(res.data.now) + ms / 2;
      } else {
        if (res.kind === "session") sessionOk = false;
        else netOk = false;
      }
    }
    if (times.length === 0) set("network", netOk ? "fail" : "fail", undefined);
    else {
      const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
      set("network", times.length < 3 || median > 4000 ? "fail" : median > 1500 ? "warn" : "pass", T("stLatency", { ms: median }));
    }
    set("session", sessionOk && times.length > 0 ? "pass" : "fail");
    // 8. clock + time zone
    if (serverNow) {
      const diff = Math.round(Math.abs(Date.now() - serverNow) / 1000);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Drift is what matters (the server sets every check-in time); a different time zone is advice only.
      set("clock", diff > 120 ? "warn" : "pass", `${T("stClockDiff", { seconds: diff })} · ${tz}`);
    } else set("clock", "skip");
    // 9. wake lock
    set("wakelock", "wakeLock" in navigator ? "pass" : "warn");
    // 11. offline shell (service worker)
    try {
      const reg = await navigator.serviceWorker?.getRegistration("/scan");
      set("offline", reg?.active ? "pass" : "warn");
    } catch {
      set("offline", "warn");
    }
    // 12. language
    set("language", "pass");
    setRunning(false);
  }, [set, T]);

  function start() {
    unlockAudio();
    setItems(initial());
    setStarted(true);
    setSaved("idle");
    decodeStart.current = performance.now();
    setCameraOn(true);
    void runAutomatic();
  }

  function onCameraState(state: CameraState) {
    if (state === "running") {
      set("camera", "pass");
      decodeStart.current = performance.now();
    } else if (state === "denied") {
      set("camera", "fail");
      set("permission", "fail");
    } else if (state === "error" || state === "unsupported") set("camera", "fail");
  }

  function onCode(code: string) {
    if (items.decode.status === "pass") return;
    if (/^PPME-LATIHAN-0[1-9]$/i.test(code.trim()) || TICKET_TOKEN_PATTERN.test(code.trim().toUpperCase())) {
      set("decode", "pass", T("stDecoded", { ms: Math.round(performance.now() - decodeStart.current) }));
      feedback("ok", false);
    }
  }

  // The decode step is optional: after the camera runs, a missing practice QR is a warning, never a block.
  const decodeStatus = items.decode.status;
  const cameraStatus = items.camera.status;

  const finished = started && !running && KEYS.every((k) => items[k].status !== "pending" || k === "decode" || k === "sound");
  const final = (): Record<Key, Status> => {
    const out = Object.fromEntries(KEYS.map((k) => [k, items[k].status])) as Record<Key, Status>;
    if (out.decode === "pending") out.decode = "warn";
    if (out.sound === "pending") out.sound = "warn";
    return out;
  };
  const results = final();
  const anyFail = Object.values(results).includes("fail");
  const anyWarn = Object.values(results).includes("warn");

  async function save() {
    setSaved("saving");
    const res = await api("selftest", { appVersion: SCANNER_APP_VERSION, items: results });
    setSaved(res.ok ? "saved" : "error");
  }

  // Release the camera as soon as the checks are done.
  useEffect(() => {
    if (finished && cameraStatus === "pass" && decodeStatus !== "pending") setCameraOn(false);
  }, [finished, cameraStatus, decodeStatus]);

  return (
    <ScreenFrame title={T("stTitle")} onBack={onBack}>
      <p className="text-[15px] leading-relaxed text-slate-600">{T("stIntro")}</p>

      {!started ? (
        <button type="button" onClick={start} className={buttonClass("primary", "lg", "w-full")}>
          <PlayIcon className="size-5" aria-hidden="true" />
          {T("stRun")}
        </button>
      ) : (
        <>
          {cameraOn ? (
            <div className="space-y-2">
              <QrCamera active={cameraOn} onCode={onCode} onState={onCameraState} className="aspect-[4/3] w-full rounded-lg" />
              <p className="text-center text-xs text-slate-500">{T("stPointCamera")}</p>
              {decodeStatus === "pending" && cameraStatus === "pass" ? (
                <button type="button" onClick={() => set("decode", "skip")} className={buttonClass("ghost", "sm", "w-full")}>
                  {T("stSkipDecode")}
                </button>
              ) : null}
            </div>
          ) : null}

          <ul className="divide-y divide-slate-200 border-y border-slate-200">
            {KEYS.map((k) => {
              const status = k === "decode" && items[k].status === "pending" && !cameraOn && started && cameraStatus !== "pending" ? "warn" : items[k].status;
              const { icon: Icon, cls } = ICON[status];
              const label = status === "pass" ? T("stPass") : status === "warn" ? T("stWarnLabel") : status === "fail" ? T("stFail") : status === "skip" ? T("stSkip") : T("stPending");
              const hint = (status === "warn" || status === "fail") && `stHint_${k}` in HINTS ? T(`stHint_${k}` as TextKey) : null;
              return (
                <li key={k} className="py-3">
                  <div className="flex items-center gap-3">
                    {status === "pending" && running ? <Spinner className="size-5 text-slate-400" /> : <Icon className={`size-5 shrink-0 ${cls}`} aria-hidden="true" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium text-slate-900">{T(`st_${k}` as TextKey)}</p>
                      {items[k].detail ? <p className="text-xs text-slate-500">{items[k].detail}</p> : null}
                    </div>
                    <span className="text-xs font-semibold text-slate-500">{label}</span>
                  </div>
                  {hint ? <p className="mt-1.5 pl-8 text-xs leading-relaxed text-slate-600">{hint}</p> : null}
                  {k === "sound" && items.sound.status === "pending" ? <SoundCheck onResult={(ok) => set("sound", ok ? "pass" : "warn")} /> : null}
                </li>
              );
            })}
          </ul>

          {finished ? (
            <div className="space-y-3">
              <Callout tone={anyFail ? "danger" : anyWarn ? "warning" : "success"} icon={anyFail ? XCircleIcon : anyWarn ? ExclamationTriangleIcon : CheckCircleIcon}>
                <p className="font-semibold">{anyFail ? T("stNotReady") : anyWarn ? T("stWarn") : T("stReady")}</p>
              </Callout>
              {saved === "saved" ? (
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                  <CheckCircleIcon className="size-5" aria-hidden="true" />
                  {T("stSaved")}
                </p>
              ) : (
                <button type="button" disabled={saved === "saving"} onClick={save} className={buttonClass("primary", "lg", "w-full")}>
                  {saved === "saving" ? <Spinner /> : null}
                  {T("stSubmit")}
                </button>
              )}
              {saved === "error" ? <p className="text-sm text-red-700">{T("errNetwork")}</p> : null}
              <button type="button" onClick={start} className={buttonClass("secondary", "md", "w-full")}>
                {T("retry")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </ScreenFrame>
  );
}

const HINTS: Record<string, true> = {
  stHint_browser: true,
  stHint_installed: true,
  stHint_permission: true,
  stHint_camera: true,
  stHint_decode: true,
  stHint_network: true,
  stHint_clock: true,
  stHint_sound: true,
  stHint_offline: true,
};

function SoundCheck({ onResult }: { onResult: (ok: boolean) => void }) {
  const T = useT();
  return (
    <div className="mt-2 space-y-2 pl-8">
      <p className="text-xs text-slate-600">{T("stSoundAsk")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { unlockAudio(); feedback("ok", true); }} className={buttonClass("secondary", "sm")}>
          {T("stSoundPlay")}
        </button>
        <button type="button" onClick={() => onResult(true)} className={buttonClass("ghost", "sm")}>
          {T("stSoundYes")}
        </button>
        <button type="button" onClick={() => onResult(false)} className={buttonClass("ghost", "sm")}>
          {T("stSoundNo")}
        </button>
      </div>
    </div>
  );
}
