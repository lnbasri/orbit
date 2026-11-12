// Formatting helpers shared by server and browser. All stored times are UTC ISO strings;
// everything shown to people is in Netherlands time.

export const EVENT_TZ = "Europe/Amsterdam";

export function formatDateTime(iso: string | null | undefined, tz = EVENT_TZ): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}`;
}

export function formatLongDate(iso: string, tz = EVENT_TZ): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatTime(iso: string, tz = EVENT_TZ): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(":", ".");
}

export function formatEuro(cents: number): string {
  const euros = cents / 100;
  return "€" + (Number.isInteger(euros) ? String(euros) : euros.toFixed(2).replace(".", ","));
}

export const REGISTRATION_STATUS_LABEL: Record<string, string> = {
  accepted: "Diterima",
  pending_payment: "Menunggu Pembayaran",
  expired: "Kedaluwarsa",
  rejected_quota: "Ditolak – kuota tidak mencukupi",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  free: "Gratis",
  pending: "Menunggu Pembayaran",
  paid: "Lunas",
  expired: "Kedaluwarsa",
  not_processed: "Tidak Diproses",
  manual: "Manual",
};

export const GENDER_LABEL: Record<string, string> = {
  male: "Laki-laki",
  female: "Perempuan",
};

// --- Local (Netherlands) wall-clock <-> UTC, for <input type="datetime-local"> in the admin area ---

function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - utcMs;
}

/** "2026-11-27T23:59" read as Europe/Amsterdam wall-clock time -> UTC ISO string (null if malformed). */
export function localInputToUtcIso(local: string, tz = EVENT_TZ): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let utc = wall - tzOffsetMs(wall, tz);
  utc = wall - tzOffsetMs(utc, tz); // second pass settles instants next to a DST change
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** UTC ISO string -> "2026-11-27T23:59" in Europe/Amsterdam, the value format of datetime-local inputs. */
export function utcIsoToLocalInput(iso: string | null | undefined, tz = EVENT_TZ): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
