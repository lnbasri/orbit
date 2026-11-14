// Browser-side helpers of the check-in app (no server imports, safe in the client bundle).
export const SCANNER_APP_VERSION = "1.0.0";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "offline" | "session" | "rate" | "server" | "bad"; status: number };

/** POST/GET JSON to /scan/api/<op>. Network failures and timeouts become `offline`; a 401 becomes `session`. */
export async function api<T = Record<string, unknown>>(
  op: string,
  body?: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 9000);
  try {
    const res = await fetch(`/scan/api/${op}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    if (res.status === 401) return { ok: false, kind: "session", status: 401 };
    if (res.status === 429) return { ok: false, kind: "rate", status: 429 };
    if (res.status >= 500) return { ok: false, kind: "server", status: res.status };
    const json = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) return { ok: false, kind: "bad", status: res.status };
    return { ok: true, data: json };
  } catch {
    return { ok: false, kind: "offline", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function isStandalone(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export function readSound(): boolean {
  try {
    return localStorage.getItem("ppme_scan_sound") !== "0";
  } catch {
    return true;
  }
}

export function writeSound(on: boolean) {
  try {
    localStorage.setItem("ppme_scan_sound", on ? "1" : "0");
  } catch {
    // private mode: fine
  }
}
