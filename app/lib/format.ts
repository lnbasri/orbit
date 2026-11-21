// Shared date formatting for ORBIT history and administrator screens.

export const ORBIT_TZ = "Europe/Amsterdam";

export function formatDateTime(iso: string | null | undefined, tz = ORBIT_TZ): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}`;
}

export function formatTime(iso: string, tz = ORBIT_TZ): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(":", ".");
}
