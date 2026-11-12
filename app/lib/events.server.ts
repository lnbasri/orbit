import { auditStatement, getEventById } from "./db.server";
import { localInputToUtcIso } from "./format";

export type EventResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Admin: set when online registration opens and closes (inputs are Netherlands wall-clock time,
 * stored as UTC). An empty value means "no limit" for that side; registration always ends when the event starts.
 */
export async function updateRegistrationWindow(
  db: D1Database,
  actor: string,
  eventId: number,
  opensLocal: string,
  closesLocal: string,
  now = new Date(),
): Promise<EventResult> {
  const event = await getEventById(db, eventId);
  if (!event) return { ok: false, message: "Acara tidak ditemukan." };

  const parse = (v: string): string | null | "invalid" => {
    if (!v.trim()) return null;
    return localInputToUtcIso(v) ?? "invalid";
  };
  const opens = parse(opensLocal);
  const closes = parse(closesLocal);
  if (opens === "invalid") return { ok: false, message: "Waktu pembukaan tidak valid." };
  if (closes === "invalid") return { ok: false, message: "Batas pendaftaran tidak valid." };
  if (opens && closes && closes <= opens) {
    return { ok: false, message: "Batas pendaftaran harus setelah waktu pembukaan." };
  }
  if (closes && closes > event.starts_at) {
    return { ok: false, message: "Batas pendaftaran tidak boleh melewati waktu mulai acara." };
  }

  await db.batch([
    db
      .prepare("UPDATE events SET registration_opens_at = ?, registration_closes_at = ? WHERE id = ?")
      .bind(opens, closes, eventId),
    auditStatement(
      db,
      actor,
      "event.registration_window",
      event.slug,
      { from: [event.registration_opens_at, event.registration_closes_at], to: [opens, closes] },
      now.toISOString(),
    ),
  ]);
  return { ok: true, message: "Jadwal pendaftaran disimpan." };
}
