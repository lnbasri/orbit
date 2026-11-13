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

/** Calendar day (YYYY-MM-DD) of an instant in the event time zone. */
export function localDateKey(iso: string | Date, tz = EVENT_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    typeof iso === "string" ? new Date(iso) : iso,
  );
}

/** Whole calendar days (event time zone) from `now` to `targetIso`; 0 = same day, negative = past. */
export function daysUntil(targetIso: string, now: Date, tz = EVENT_TZ): number {
  const day = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
  return Math.round((day(localDateKey(targetIso, tz)) - day(localDateKey(now, tz))) / 86_400_000);
}

export const REGISTRATION_STATUS_LABEL: Record<string, string> = {
  accepted: "Diterima",
  pending_payment: "Menunggu Pembayaran",
  expired: "Kedaluwarsa",
  rejected_quota: "Ditolak – kuota tidak mencukupi",
  rejected_membership: "Ditolak – keanggotaan tidak valid",
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
  "laki-laki": "Laki-laki",
  perempuan: "Perempuan",
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

/** Upper bound for a seat quota (admin settings). */
export const MAX_QUOTA = 1000;

export const AGE_GROUPS = ["balita", "anak", "remaja", "dewasa"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];
export const AGE_GROUP_LABEL: Record<string, string> = {
  balita: "Balita (di bawah 5 tahun)",
  anak: "Anak (5 – <12 tahun)",
  remaja: "Remaja (12 – <18 tahun)",
  dewasa: "Dewasa (18 tahun ke atas)",
};
export const AGE_GROUP_SHORT: Record<string, string> = { balita: "Balita", anak: "Anak", remaja: "Remaja", dewasa: "Dewasa" };

/** Only these age groups pay the non-member fee; balita and anak attend free. */
export const PAYING_AGE_GROUPS: readonly string[] = ["remaja", "dewasa"];
export const isPayingAgeGroup = (g: string) => PAYING_AGE_GROUPS.includes(g);
/** Number of participants who pay (remaja + dewasa). */
export const payingCount = (participants: { ageGroup: string }[]) => participants.filter((p) => isPayingAgeGroup(p.ageGroup)).length;

// --- CSV export: Indonesian headers and values (lowercase, as the committee reads them in Excel) ---

const CSV_REGISTRATION_STATUS: Record<string, string> = {
  accepted: "diterima",
  pending_payment: "menunggu pembayaran",
  expired: "kedaluwarsa",
  rejected_quota: "ditolak (kuota penuh)",
  rejected_membership: "ditolak (keanggotaan tidak valid)",
};
const CSV_PARTICIPANT_STATUS: Record<string, string> = {
  accepted: "diterima",
  pending_payment: "menunggu pembayaran",
  expired: "kedaluwarsa",
  rejected: "ditolak",
};
const CSV_PAYMENT_STATUS: Record<string, string> = {
  free: "gratis",
  pending: "menunggu pembayaran",
  paid: "lunas",
  expired: "kedaluwarsa",
  not_processed: "tidak diproses",
  manual: "manual",
};
const CSV_CATEGORY: Record<string, string> = { member: "anggota", non_member: "non-anggota" };
const CSV_SOURCE: Record<string, string> = { online: "online", manual: "manual" };

const lookup = (map: Record<string, string>, v: unknown) => (v == null || v === "" ? "" : (map[String(v)] ?? String(v)));
const csvTime = (v: unknown) => (typeof v === "string" ? formatDateTime(v) : "");

/** Turns raw export rows (DB codes, UTC times, cents) into Indonesian CSV rows; keys are the column headers. */
export function exportRowsToIndonesian(rows: Record<string, unknown>[]): { rows: Record<string, unknown>[]; columns: string[] } {
  const build = (r: Record<string, unknown>) => ({
    "ID Pendaftaran": r.registration_id,
    "Waktu Daftar": csvTime(r.created_at),
    "Nama Pendaftar": r.registrant_name,
    Email: r.email,
    WhatsApp: r.whatsapp,
    Keanggotaan: lookup(CSV_CATEGORY, r.category),
    Sumber: lookup(CSV_SOURCE, r.source),
    "Status Pendaftaran": lookup(CSV_REGISTRATION_STATUS, r.registration_status),
    "Status Pembayaran": lookup(CSV_PAYMENT_STATUS, r.payment_status),
    "Kode Pembayaran": r.payment_code,
    "Jumlah (€)": typeof r.amount_cents === "number" ? (r.amount_cents / 100).toFixed(2).replace(".", ",") : "",
    "Batas Pembayaran": csvTime(r.pay_deadline),
    "Waktu Lunas": csvTime(r.paid_at),
    "Dikonfirmasi Oleh": r.confirmed_by,
    "Keanggotaan Diverifikasi": csvTime(r.membership_verified_at),
    "Diverifikasi Oleh": r.membership_verified_by,
    "ID Peserta": r.participant_id,
    "No. Peserta": r.position,
    "Nama Peserta": r.full_name,
    "Kelompok Usia": r.age_group,
    "Jenis Kelamin": r.gender,
    "Status Peserta": lookup(CSV_PARTICIPANT_STATUS, r.participant_status),
    "Kode Tiket": r.ticket_code,
    "Waktu Check-in": csvTime(r.checked_in_at),
  });
  return { rows: rows.map(build), columns: Object.keys(build({})) };
}
