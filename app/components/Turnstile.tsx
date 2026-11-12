import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
    __turnstileLoading?: Promise<void>;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!window.__turnstileLoading) {
    window.__turnstileLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Turnstile gagal dimuat"));
      document.head.appendChild(s);
    });
  }
  return window.__turnstileLoading;
}

/**
 * Cloudflare Turnstile widget (explicit rendering, works with client-side navigation).
 * It adds a hidden `cf-turnstile-response` input to the surrounding form.
 * Change `resetKey` to get a fresh token after a failed submit (tokens are single-use).
 */
export function Turnstile({
  siteKey,
  resetKey,
  onToken,
}: {
  siteKey: string;
  resetKey?: unknown;
  onToken?: (token: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile || widgetId.current) return;
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          language: "id",
          callback: (token: string) => onTokenRef.current?.(token),
          "expired-callback": () => onTokenRef.current?.(null),
          "error-callback": () => onTokenRef.current?.(null),
        });
      })
      .catch(() => onTokenRef.current?.(null));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey === undefined || !widgetId.current || !window.turnstile) return;
    window.turnstile.reset(widgetId.current);
    onTokenRef.current?.(null);
  }, [resetKey]);

  return <div ref={ref} className="min-h-[65px]" />;
}
