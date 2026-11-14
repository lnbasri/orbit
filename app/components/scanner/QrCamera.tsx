import { ArrowPathIcon, CameraIcon, ExclamationTriangleIcon, LightBulbIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "./lang";

export type CameraState = "idle" | "starting" | "running" | "denied" | "error" | "unsupported";

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

const SAME_CODE_PAUSE_MS = 3000;
const SCAN_INTERVAL_MS = 110;
const MAX_DECODE_WIDTH = 640;

/**
 * Rear-camera QR reader. Uses the browser's BarcodeDetector where it exists (Android Chrome) and jsQR otherwise (iOS Safari
 * has no BarcodeDetector). jsQR is bundled with the app (no CDN, no third party). The same code is not reported twice within
 * 3 seconds. The camera is released when `active` turns false, when the page is hidden, and on unmount.
 */
export function QrCamera({
  active,
  onCode,
  onState,
  className = "",
}: {
  active: boolean;
  onCode: (code: string) => void;
  onState?: (state: CameraState, error?: string) => void;
  className?: string;
}) {
  const T = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCodeRef = useRef(onCode);
  const onStateRef = useRef(onState);
  onCodeRef.current = onCode;
  onStateRef.current = onState;
  const [state, setState] = useState<CameraState>("idle");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(true);

  const update = useCallback((s: CameraState, error?: string) => {
    setState(s);
    onStateRef.current?.(s, error);
  }, []);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!active || !visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wakeLock: { release: () => Promise<void> } | null = null;
    const last = { code: "", at: 0 };

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        update("unsupported");
        return;
      }
      update("starting");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        const name = (err as DOMException)?.name ?? "";
        if (!cancelled) update(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error", name);
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        update("error", "play");
        return;
      }
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorchSupported(!!caps.torch);
      update("running");

      try {
        wakeLock = (await (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen")) ?? null;
      } catch {
        wakeLock = null;
      }

      const Native = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      let detector: BarcodeDetectorLike | null = null;
      try {
        detector = Native ? new Native({ formats: ["qr_code"] }) : null;
      } catch {
        detector = null;
      }
      const jsQR = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const g = canvas.getContext("2d", { willReadFrequently: true });

      const emit = (value: string) => {
        const now = Date.now();
        if (value === last.code && now - last.at < SAME_CODE_PAUSE_MS) return;
        last.code = value;
        last.at = now;
        onCodeRef.current(value);
      };

      const tick = async () => {
        if (cancelled) return;
        try {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            if (detector) {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) emit(found[0].rawValue);
            } else if (jsQR && g) {
              const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              g.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = g.getImageData(0, 0, canvas.width, canvas.height);
              const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
              if (hit?.data) emit(hit.data);
            }
          }
        } catch {
          // a failed frame is not fatal
        }
        timer = setTimeout(tick, SCAN_INTERVAL_MS);
      };
      void tick();
    }

    void start();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      void wakeLock?.release().catch(() => undefined);
      setTorchOn(false);
      setTorchSupported(false);
      setState("idle");
    };
  }, [active, visible, attempt, update]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }

  const failed = state === "denied" || state === "error" || state === "unsupported";

  return (
    <div className={`relative isolate overflow-hidden bg-slate-950 ${className}`}>
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" />
      {state === "running" ? (
        <>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_38%,rgb(2_6_23/0.55)_70%)]" aria-hidden="true" />
          <div className="pointer-events-none absolute top-1/2 left-1/2 aspect-square w-[68%] max-w-72 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
            <span className="absolute top-0 left-0 size-9 rounded-tl-lg border-t-[3px] border-l-[3px] border-white" />
            <span className="absolute top-0 right-0 size-9 rounded-tr-lg border-t-[3px] border-r-[3px] border-white" />
            <span className="absolute bottom-0 left-0 size-9 rounded-bl-lg border-b-[3px] border-l-[3px] border-white" />
            <span className="absolute right-0 bottom-0 size-9 rounded-br-lg border-r-[3px] border-b-[3px] border-white" />
          </div>
        </>
      ) : null}

      {state === "starting" ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
          <CameraIcon className="size-5 animate-pulse" aria-hidden="true" />
          {T("cameraStarting")}
        </div>
      ) : null}

      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950 px-8 text-center text-white">
          <ExclamationTriangleIcon className="size-9 text-amber-400" aria-hidden="true" />
          <p className="text-base font-semibold">
            {state === "denied" ? T("cameraDeniedTitle") : state === "unsupported" ? T("cameraUnsupported") : T("cameraErrorTitle")}
          </p>
          {state !== "unsupported" ? (
            <p className="text-sm leading-relaxed text-white/70">{state === "denied" ? T("cameraDeniedHelp") : T("cameraErrorHelp")}</p>
          ) : null}
          {state !== "unsupported" ? (
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              <ArrowPathIcon className="size-4" aria-hidden="true" />
              {T("retry")}
            </button>
          ) : null}
        </div>
      ) : null}

      {state === "running" && torchSupported ? (
        <button
          type="button"
          onClick={toggleTorch}
          aria-pressed={torchOn}
          aria-label={T("torchOn")}
          className={`absolute right-3 bottom-3 flex size-11 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
            torchOn ? "border-amber-300 bg-amber-300 text-slate-900" : "border-white/40 bg-slate-900/60 text-white"
          }`}
        >
          <LightBulbIcon className="size-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
