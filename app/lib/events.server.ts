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

/**
 * Admin: set when the event actually starts and ends (inputs are Netherlands wall-clock time, stored as UTC).
 * Registration always ends at the start, so the start may not move before the registration opening/closing time;
 * move those first. Affects what is shown from now on (form, new emails), nothing is re-sent.
 */
export async function updateEventTimes(
  db: D1Database,
  actor: string,
  eventId: number,
  startsLocal: string,
  endsLocal: string,
  now = new Date(),
): Promise<EventResult> {
  const event = await getEventById(db, eventId);
  if (!event) return { ok: false, message: "Acara tidak ditemukan." };

  const starts = startsLocal.trim() ? localInputToUtcIso(startsLocal) : null;
  const ends = endsLocal.trim() ? localInputToUtcIso(endsLocal) : null;
  if (!starts) return { ok: false, message: "Waktu mulai acara wajib diisi dengan format yang valid." };
  if (!ends) return { ok: false, message: "Waktu selesai acara wajib diisi dengan format yang valid." };
  if (ends <= starts) return { ok: false, message: "Waktu selesai harus setelah waktu mulai." };
  if (event.registration_opens_at && event.registration_opens_at >= starts) {
    return { ok: false, message: "Waktu mulai acara harus setelah pendaftaran dibuka. Ubah jadwal pendaftaran lebih dulu." };
  }
  if (event.registration_closes_at && event.registration_closes_at > starts) {
    return {
      ok: false,
      message: "Waktu mulai acara tidak boleh sebelum batas pendaftaran. Ubah batas pendaftaran lebih dulu.",
    };
  }
  if (starts === event.starts_at && ends === event.ends_at) return { ok: true, message: "Waktu acara tidak berubah." };

  await db.batch([
    db.prepare("UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?").bind(starts, ends, eventId),
    auditStatement(
      db,
      actor,
      "event.times",
      event.slug,
      { from: [event.starts_at, event.ends_at], to: [starts, ends] },
      now.toISOString(),
    ),
  ]);
  return { ok: true, message: "Waktu acara disimpan." };
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
 * Admin: set the speaker (pemateri) and theme (tema) shown on the form and in emails. Both are optional (empty = hidden).
 * Only affects what is displayed from now on; emails already sent are not touched.
 */
export async function updateEventDetails(
  db: D1Database,
  actor: string,
  eventId: number,
  speakerInput: string,
  themeInput: string,
  now = new Date(),
): Promise<EventResult> {
  const event = await getEventById(db, eventId);
  if (!event) return { ok: false, message: "Acara tidak ditemukan." };
  const speaker = speakerInput.trim().replace(/\s+/g, " ");
  const theme = themeInput.trim().replace(/\s+/g, " ");
  if (speaker.length > 120) return { ok: false, message: "Nama pemateri terlalu panjang (maksimal 120 karakter)." };
  if (theme.length > 200) return { ok: false, message: "Tema terlalu panjang (maksimal 200 karakter)." };
  if ((speaker || null) === event.speaker && (theme || null) === event.theme) {
    return { ok: true, message: "Pemateri dan tema tidak berubah." };
  }

  await db.batch([
    db.prepare("UPDATE events SET speaker = ?, theme = ? WHERE id = ?").bind(speaker || null, theme || null, eventId),
    auditStatement(
      db,
      actor,
      "event.details",
      event.slug,
      { from: { speaker: event.speaker, theme: event.theme }, to: { speaker: speaker || null, theme: theme || null } },
      now.toISOString(),
    ),
  ]);
  return { ok: true, message: "Pemateri dan tema disimpan." };
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
