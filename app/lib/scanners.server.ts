import { normalizeEmail, parseEmailList } from "./admins.server";
import { auditStatement, type EventRow } from "./db.server";
import { checkinStats, type ScannerRole } from "./checkin.server";
import { normalizeWhatsapp } from "./validation";

/** Admin-side management of the scanning team, escalation contacts, device self-tests and the check-in gate. */

export type Result = { ok: true; message: string } | { ok: false; message: string };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ScannerListRow {
  id: number;
  email: string;
  name: string | null;
  role: ScannerRole;
  active: number;
  participant_id: string | null;
  added_by: string;
  added_at: string;
  last_login_at: string | null;
  sessions: number;
  test_at: string | null;
  test_passed: number | null;
  test_device: string | null;
  /** The scanner's own registration (same email), if any: used for the own-ticket rule. */
  registered: number;
  linked_name: string | null;
}

export async function listScanners(db: D1Database, now = new Date()): Promise<ScannerListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM scanner_sessions ss WHERE ss.scanner_id = s.id AND ss.expires_at > ?) AS sessions,
         (SELECT t.at FROM scanner_selftests t WHERE t.scanner_id = s.id ORDER BY t.id DESC LIMIT 1) AS test_at,
         (SELECT t.passed FROM scanner_selftests t WHERE t.scanner_id = s.id ORDER BY t.id DESC LIMIT 1) AS test_passed,
         (SELECT t.device_label FROM scanner_selftests t WHERE t.scanner_id = s.id ORDER BY t.id DESC LIMIT 1) AS test_device,
         (SELECT COUNT(*) FROM registrations r WHERE lower(r.email) = s.email
            AND r.status IN ('accepted', 'pending_payment', 'pending_membership')) AS registered,
         (SELECT p.full_name FROM participants p WHERE p.id = s.participant_id) AS linked_name
       FROM scanners s ORDER BY s.role DESC, s.added_at, s.email`,
    )
    .bind(now.toISOString())
    .all<ScannerListRow>();
  return results;
}

export interface LinkSuggestion {
  scannerId: number;
  participantId: string;
  name: string;
  registrationLabel: string;
}

/** Participants whose full name equals the scanner's name (a scanner registered as a second person in someone else's registration). */
export async function linkSuggestions(db: D1Database, scanners: ScannerListRow[]): Promise<LinkSuggestion[]> {
  const out: LinkSuggestion[] = [];
  for (const s of scanners) {
    if (!s.name || s.participant_id) continue;
    const { results } = await db
      .prepare(
        `SELECT p.id, p.full_name, r.registrant_name FROM participants p JOIN registrations r ON r.id = p.registration_id
         WHERE lower(p.full_name) = lower(?) AND lower(coalesce(r.email, '')) <> ? AND r.status IN ('accepted', 'pending_payment', 'pending_membership')
         LIMIT 3`,
      )
      .bind(s.name.trim(), s.email)
      .all<{ id: string; full_name: string; registrant_name: string }>();
    for (const r of results) {
      out.push({ scannerId: s.id, participantId: r.id, name: r.full_name, registrationLabel: `pendaftaran ${r.registrant_name}` });
    }
  }
  return out;
}

/** "email, name" per line (or just emails separated by commas/semicolons/spaces). */
export function parseScannerLines(text: string): { email: string; name: string | null }[] {
  const out = new Map<string, string | null>();
  for (const line of text.split(/\r?\n/)) {
    const emails = parseEmailList(line);
    if (emails.length === 0) continue;
    if (emails.length === 1) {
      const email = emails[0];
      const name = line.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").replace(/[,;<>]/g, " ").trim().slice(0, 120);
      out.set(email, name || null);
    } else {
      for (const e of emails) out.set(e, null);
    }
  }
  return [...out].map(([email, name]) => ({ email, name }));
}

export async function addScanners(
  db: D1Database,
  actor: string,
  text: string,
  role: ScannerRole,
  now = new Date(),
): Promise<Result> {
  const rows = parseScannerLines(text);
  if (rows.length === 0) return { ok: false, message: "Masukkan minimal satu alamat email yang valid." };
  if (rows.length > 60) return { ok: false, message: "Maksimal 60 petugas sekali tambah." };
  const nowIso = now.toISOString();
  const res = await db.batch(
    rows.map((r) =>
      db
        .prepare("INSERT OR IGNORE INTO scanners (email, name, role, added_by, added_at) VALUES (?, ?, ?, ?, ?)")
        .bind(r.email, r.name, role, normalizeEmail(actor), nowIso),
    ),
  );
  const added = res.filter((r) => (r.meta.changes ?? 0) === 1).length;
  if (added === 0) return { ok: false, message: "Semua email itu sudah terdaftar sebagai petugas." };
  await auditStatement(db, actor, "scanner.add", null, { count: added, role }, nowIso).run();
  const skipped = rows.length - added;
  return { ok: true, message: `${added} petugas ditambahkan${skipped ? ` (${skipped} sudah ada)` : ""}.` };
}

export async function setScannerRole(db: D1Database, actor: string, id: number, role: ScannerRole, now = new Date()): Promise<Result> {
  if (role !== "scanner" && role !== "lead") return { ok: false, message: "Peran tidak dikenal." };
  const res = await db.prepare("UPDATE scanners SET role = ? WHERE id = ? AND role <> ?").bind(role, id, role).run();
  if ((res.meta.changes ?? 0) !== 1) return { ok: false, message: "Peran tidak berubah." };
  await auditStatement(db, actor, "scanner.role", String(id), { role }, now.toISOString()).run();
  return { ok: true, message: role === "lead" ? "Dijadikan ketua tim." : "Dijadikan petugas biasa." };
}

/** Deactivating ends all their sessions at once. */
export async function setScannerActive(db: D1Database, actor: string, id: number, active: boolean, now = new Date()): Promise<Result> {
  const res = await db.batch([
    db.prepare("UPDATE scanners SET active = ? WHERE id = ? AND active <> ?").bind(active ? 1 : 0, id, active ? 1 : 0),
    ...(active ? [] : [db.prepare("DELETE FROM scanner_sessions WHERE scanner_id = ?").bind(id)]),
    auditStatement(db, actor, active ? "scanner.activate" : "scanner.deactivate", String(id), undefined, now.toISOString()),
  ]);
  if ((res[0].meta.changes ?? 0) !== 1) return { ok: false, message: "Status tidak berubah." };
  return { ok: true, message: active ? "Petugas diaktifkan." : "Petugas dinonaktifkan dan sesinya diakhiri." };
}

export async function removeScanner(db: D1Database, actor: string, id: number, now = new Date()): Promise<Result> {
  const row = await db.prepare("SELECT email FROM scanners WHERE id = ?").bind(id).first<{ email: string }>();
  if (!row) return { ok: false, message: "Petugas tidak ditemukan." };
  await db.batch([
    db.prepare("DELETE FROM scanner_sessions WHERE scanner_id = ?").bind(id),
    db.prepare("DELETE FROM scanner_selftests WHERE scanner_id = ?").bind(id),
    db.prepare("DELETE FROM scanners WHERE id = ?").bind(id),
    auditStatement(db, actor, "scanner.remove", String(id), undefined, now.toISOString()),
  ]);
  return { ok: true, message: `${row.email} dihapus dari tim scan.` };
}

export async function linkScannerParticipant(
  db: D1Database,
  actor: string,
  id: number,
  participantId: string | null,
  now = new Date(),
): Promise<Result> {
  if (participantId) {
    const exists = await db.prepare("SELECT 1 AS x FROM participants WHERE id = ?").bind(participantId).first();
    if (!exists) return { ok: false, message: "Peserta tidak ditemukan." };
  }
  const res = await db.prepare("UPDATE scanners SET participant_id = ? WHERE id = ?").bind(participantId, id).run();
  if ((res.meta.changes ?? 0) !== 1) return { ok: false, message: "Petugas tidak ditemukan." };
  await auditStatement(db, actor, "scanner.link", String(id), { participantId }, now.toISOString()).run();
  return { ok: true, message: participantId ? "Peserta ditautkan: petugas ini tidak dapat scan tiketnya sendiri." : "Tautan peserta dihapus." };
}

export async function logoutAllScanners(db: D1Database, actor: string, now = new Date()): Promise<Result> {
  const res = await db.prepare("DELETE FROM scanner_sessions").run();
  await auditStatement(db, actor, "scanner.logout_all", null, { sessions: res.meta.changes ?? 0 }, now.toISOString()).run();
  return { ok: true, message: `${res.meta.changes ?? 0} sesi petugas diakhiri.` };
}

/** After the event: remove every scanner (and their sessions and test results). */
export async function removeAllScanners(db: D1Database, actor: string, now = new Date()): Promise<Result> {
  const n = await db.prepare("SELECT COUNT(*) AS n FROM scanners").first<{ n: number }>();
  await db.batch([
    db.prepare("DELETE FROM scanner_sessions"),
    db.prepare("DELETE FROM scanner_selftests"),
    db.prepare("DELETE FROM scanner_login_codes"),
    db.prepare("DELETE FROM scanners"),
    auditStatement(db, actor, "scanner.remove_all", null, { count: n?.n ?? 0 }, now.toISOString()),
  ]);
  return { ok: true, message: `${n?.n ?? 0} petugas dihapus.` };
}

// ---------------------------------------------------------------- self-test results

export async function saveSelfTest(
  db: D1Database,
  scannerId: number,
  deviceLabel: string | null,
  input: { appVersion: string; passed: boolean; items: Record<string, string> },
  now = new Date(),
) {
  const items: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.items).slice(0, 20)) {
    if (/^[a-z_]{1,24}$/.test(k) && ["pass", "warn", "fail", "skip"].includes(v)) items[k] = v;
  }
  // The result is recomputed here: a self-test passes only when nothing failed.
  const passed = !Object.values(items).includes("fail");
  await db
    .prepare("INSERT INTO scanner_selftests (scanner_id, at, device_label, app_version, passed, result_json) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(scannerId, now.toISOString(), deviceLabel, input.appVersion.slice(0, 40), passed ? 1 : 0, JSON.stringify(items))
    .run();
  return { passed };
}

// ---------------------------------------------------------------- escalation contacts

export interface EscalationContact {
  id: number;
  level: 1 | 2 | 3;
  name: string;
  role_label: string | null;
  phone: string;
  note: string | null;
  sort_order: number;
  active: number;
}

export async function listContacts(db: D1Database, onlyActive = false): Promise<EscalationContact[]> {
  const { results } = await db
    .prepare(`SELECT * FROM escalation_contacts ${onlyActive ? "WHERE active = 1" : ""} ORDER BY level, sort_order, id`)
    .all<EscalationContact>();
  return results;
}

export async function saveContact(
  db: D1Database,
  actor: string,
  input: { id?: number | null; level: string; name: string; roleLabel: string; phone: string; note: string },
  now = new Date(),
): Promise<Result> {
  const level = Number(input.level);
  if (![1, 2, 3].includes(level)) return { ok: false, message: "Pilih tingkat eskalasi." };
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, message: "Nama wajib diisi." };
  const phone = normalizeWhatsapp(input.phone.trim());
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return { ok: false, message: "Nomor telepon tidak valid. Gunakan format internasional, mis. +31 6 12345678." };
  const roleLabel = input.roleLabel.trim().slice(0, 80) || null;
  const note = input.note.trim().slice(0, 200) || null;
  const nowIso = now.toISOString();
  if (input.id) {
    const res = await db
      .prepare("UPDATE escalation_contacts SET level = ?, name = ?, role_label = ?, phone = ?, note = ? WHERE id = ?")
      .bind(level, name, roleLabel, phone, note, input.id)
      .run();
    if ((res.meta.changes ?? 0) !== 1) return { ok: false, message: "Kontak tidak ditemukan." };
    await auditStatement(db, actor, "escalation.update", String(input.id), { level }, nowIso).run();
    return { ok: true, message: "Kontak disimpan." };
  }
  const row = await db
    .prepare(
      `INSERT INTO escalation_contacts (level, name, role_label, phone, note, sort_order)
       VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM escalation_contacts WHERE level = ?), 0)) RETURNING id`,
    )
    .bind(level, name, roleLabel, phone, note, level)
    .first<{ id: number }>();
  await auditStatement(db, actor, "escalation.add", String(row?.id), { level }, nowIso).run();
  return { ok: true, message: "Kontak ditambahkan." };
}

export async function deleteContact(db: D1Database, actor: string, id: number, now = new Date()): Promise<Result> {
  const res = await db.prepare("DELETE FROM escalation_contacts WHERE id = ?").bind(id).run();
  if ((res.meta.changes ?? 0) !== 1) return { ok: false, message: "Kontak tidak ditemukan." };
  await auditStatement(db, actor, "escalation.delete", String(id), undefined, now.toISOString()).run();
  return { ok: true, message: "Kontak dihapus." };
}

export async function setContactActive(db: D1Database, actor: string, id: number, active: boolean, now = new Date()): Promise<Result> {
  const res = await db.prepare("UPDATE escalation_contacts SET active = ? WHERE id = ?").bind(active ? 1 : 0, id).run();
  if ((res.meta.changes ?? 0) !== 1) return { ok: false, message: "Kontak tidak ditemukan." };
  await auditStatement(db, actor, "escalation.active", String(id), { active }, now.toISOString()).run();
  return { ok: true, message: active ? "Kontak ditampilkan di aplikasi." : "Kontak disembunyikan dari aplikasi." };
}

// ---------------------------------------------------------------- gate settings

/** `opensAt` / `closesAt` are UTC ISO strings or "" (empty = default: 1 hour before start to 1 hour after end). */
export async function updateCheckinGate(
  db: D1Database,
  actor: string,
  event: EventRow,
  input: { enabled: boolean; opensAt: string; closesAt: string },
  now = new Date(),
): Promise<Result> {
  const opens = input.opensAt || null;
  const closes = input.closesAt || null;
  if (opens && closes && opens >= closes) return { ok: false, message: "Jam buka check-in harus lebih awal dari jam tutup." };
  await db.batch([
    db
      .prepare("UPDATE events SET checkin_enabled = ?, checkin_opens_at = ?, checkin_closes_at = ? WHERE id = ?")
      .bind(input.enabled ? 1 : 0, opens, closes, event.id),
    auditStatement(
      db,
      actor,
      "event.checkin_gate",
      event.slug,
      {
        from: { enabled: event.checkin_enabled, opens: event.checkin_opens_at, closes: event.checkin_closes_at },
        to: { enabled: input.enabled, opens, closes },
      },
      now.toISOString(),
    ),
  ]);
  return { ok: true, message: input.enabled ? "Pengaturan check-in disimpan." : "Check-in DIMATIKAN: semua perangkat petugas ditolak." };
}

// ---------------------------------------------------------------- live view for /admin/checkin

export interface RecentCheckin {
  id: number;
  at: string;
  action: string;
  reason: string | null;
  scanner_label: string | null;
  device_label: string | null;
  participant: string | null;
  registrant: string | null;
}

export async function recentCheckins(db: D1Database, eventId: number, limit = 40): Promise<RecentCheckin[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.at, l.action, l.reason, l.scanner_label, l.device_label, p.full_name AS participant, r.registrant_name AS registrant
       FROM checkin_log l LEFT JOIN participants p ON p.id = l.participant_id LEFT JOIN registrations r ON r.id = l.registration_id
       WHERE l.event_id = ? OR l.event_id IS NULL ORDER BY l.id DESC LIMIT ?`,
    )
    .bind(eventId, limit)
    .all<RecentCheckin>();
  return results;
}

export async function checkinOverview(db: D1Database, event: EventRow) {
  const [stats, recent, counts] = await Promise.all([
    checkinStats(db, event.id),
    recentCheckins(db, event.id),
    db
      .prepare(
        `SELECT action, COUNT(*) AS n FROM checkin_log WHERE event_id = ? AND action IN ('duplicate', 'blocked', 'invalid', 'deny', 'escalate', 'override', 'undo') GROUP BY action`,
      )
      .bind(event.id)
      .all<{ action: string; n: number }>(),
  ]);
  const byAction: Record<string, number> = {};
  for (const c of counts.results) byAction[c.action] = c.n;
  return { stats, recent, byAction };
}
