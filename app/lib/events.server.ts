import { SEATS_USED_SQL, auditStatement, getEventById, seatsUsed } from "./db.server";
import { MAX_QUOTA, localInputToUtcIso } from "./format";

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

/** Parse "10", "10,50" or "10.50" (euros) into cents; null if not a valid amount. */
export function parseEuroToCents(v: string): number | null {
  const s = v.trim().replace(/^€\s*/, "").replace(",", ".");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

/**
 * Admin: set the non-member price per person. Only affects registrations made afterwards; existing
 * registrations keep their stored amount_cents (a pending one is recalculated only if the registrant edits it).
 */
export async function updateEventPrice(
  db: D1Database,
  actor: string,
  eventId: number,
  priceInput: string,
  now = new Date(),
): Promise<EventResult> {
  const event = await getEventById(db, eventId);
  if (!event) return { ok: false, message: "Acara tidak ditemukan." };
  const cents = parseEuroToCents(priceInput);
  if (cents === null || cents <= 0) {
    return { ok: false, message: "Biaya tidak valid. Isi jumlah euro lebih dari 0, misalnya 10 atau 12,50." };
  }
  if (cents === event.price_non_member_cents) return { ok: true, message: "Biaya tidak berubah." };

  await db.batch([
    db.prepare("UPDATE events SET price_non_member_cents = ? WHERE id = ?").bind(cents, eventId),
    auditStatement(
      db,
      actor,
      "event.price",
      event.slug,
      { from: event.price_non_member_cents, to: cents },
      now.toISOString(),
    ),
  ]);
  return { ok: true, message: "Biaya disimpan. Berlaku untuk pendaftaran baru." };
}



/**
 * Admin: set the seat capacity per group. A group's capacity can never go below the seats it currently
 * holds; the check is inside the UPDATE (same seat rule as registration) so a concurrent registration can't slip under it.
 */
export async function updateQuotas(
  db: D1Database,
  actor: string,
  eventId: number,
  memberInput: string,
  nonMemberInput: string,
  now = new Date(),
): Promise<EventResult> {
  const event = await getEventById(db, eventId);
  if (!event) return { ok: false, message: "Acara tidak ditemukan." };
  const parse = (v: string) => (/^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : null);
  const member = parse(memberInput);
  const nonMember = parse(nonMemberInput);
  if (member === null || nonMember === null || member > MAX_QUOTA || nonMember > MAX_QUOTA) {
    return { ok: false, message: `Kuota harus berupa bilangan bulat 0–${MAX_QUOTA}.` };
  }
  const nowIso = now.toISOString();
  const res = await db
    .prepare(
      `UPDATE events SET quota_member = ?, quota_non_member = ?
       WHERE id = ? AND ? >= (${SEATS_USED_SQL.replace("event_id = ? AND is_member = ?", "event_id = ? AND is_member = 1")})
         AND ? >= (${SEATS_USED_SQL.replace("event_id = ? AND is_member = ?", "event_id = ? AND is_member = 0")})`,
    )
    .bind(member, nonMember, eventId, member, eventId, nowIso, nonMember, eventId, nowIso)
    .run();
  if (!res.meta.changes) {
    return { ok: false, message: "Kuota tidak boleh lebih kecil dari jumlah kursi yang sudah terpakai. Muat ulang halaman." };
  }
  await auditStatement(
    db,
    actor,
    "event.quota",
    event.slug,
    { from: [event.quota_member, event.quota_non_member], to: [member, nonMember] },
    nowIso,
  ).run();
  return { ok: true, message: "Kuota disimpan." };
}
