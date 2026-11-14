// "Add to calendar" for the confirmation email: an .ics attachment (Apple Calendar, Outlook, Thunderbird, Google via
// import) plus ready-made links for Google Calendar and Outlook.com (web). No third-party service is called and no
// personal data is put in any of it: it only describes the public event.
import { bytesToBase64 } from "../png";

export interface CalendarEvent {
  slug: string;
  title: string;
  speaker: string | null;
  theme: string | null;
  starts_at: string;
  ends_at: string;
  info_url?: string | null;
}

/** 2026-12-05T08:00:00.000Z -> 20261205T080000Z */
const icsStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const summary = (e: CalendarEvent) => `${e.title}${e.speaker ? ` bersama ${e.speaker}` : ""}`;

/** Plain-text description shared by the .ics and the web links. */
export function calendarDescription(e: CalendarEvent): string {
  return [
    e.theme ? `Tema: ${e.theme}` : null,
    "Penyelenggara: Panitia Kajian PPME Den Haag",
    "Tunjukkan QR Code dari email konfirmasi kepada panitia saat check-in.",
    e.info_url ? `Info acara: ${e.info_url}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 line folding: at most 75 octets per line, continuation lines start with one space. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (curBytes + n > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74; // the leading space of a continuation line counts too
    }
    cur += ch;
    curBytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** The calendar file. UID is stable per event, so adding it twice updates the same entry instead of duplicating it. */
export function buildIcs(e: CalendarEvent, now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PPME Den Haag//Event Registration//ID",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.slug}@event.ppmedenhaag.nl`,
    `DTSTAMP:${icsStamp(now.toISOString())}`,
    `DTSTART:${icsStamp(e.starts_at)}`,
    `DTEND:${icsStamp(e.ends_at)}`,
    `SUMMARY:${icsEscape(summary(e))}`,
    `DESCRIPTION:${icsEscape(calendarDescription(e))}`,
    ...(e.info_url ? [`URL:${e.info_url}`] : []),
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(`Besok: ${e.title}`)}`,
    "TRIGGER:-P1D",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function icsAttachment(e: CalendarEvent, now?: Date) {
  return {
    filename: "kajian-ppme-den-haag.ics",
    contentBase64: bytesToBase64(new TextEncoder().encode(buildIcs(e, now))),
    contentType: "text/calendar; charset=utf-8",
  };
}

/** Links that open the "new event" form of an online calendar, prefilled. */
export function calendarLinks(e: CalendarEvent): { google: string; outlook: string } {
  const google = new URL("https://calendar.google.com/calendar/render");
  google.searchParams.set("action", "TEMPLATE");
  google.searchParams.set("text", summary(e));
  google.searchParams.set("dates", `${icsStamp(e.starts_at)}/${icsStamp(e.ends_at)}`);
  google.searchParams.set("details", calendarDescription(e));

  const outlook = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  outlook.searchParams.set("path", "/calendar/action/compose");
  outlook.searchParams.set("rru", "addevent");
  outlook.searchParams.set("subject", summary(e));
  outlook.searchParams.set("startdt", new Date(e.starts_at).toISOString());
  outlook.searchParams.set("enddt", new Date(e.ends_at).toISOString());
  outlook.searchParams.set("body", calendarDescription(e));
  return { google: google.toString(), outlook: outlook.toString() };
}
