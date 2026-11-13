// Email bodies ported from the Apps Script version (Code.gs), with the stray markup fixed (B9).
import { formatDateTime, formatEuro, formatLongDate, formatTime } from "../format";
import { registrationRules } from "../rules";

export interface EventInfo {
  title: string;
  speaker: string | null;
  theme: string | null;
  starts_at: string;
  ends_at: string;
  max_family: number;
  price_non_member_cents: number;
  pay_window_min: number;
}

export interface BankInfo {
  accountName: string;
  iban: string;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

const wrap = (inner: string) =>
  `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#333;max-width:640px;">` +
  `<h2 style="color:#023771;">Kajian PPME Den Haag</h2>` +
  `<p>Assalamu’alaikum warahmatullahi wabarakatuh,</p>` +
  inner +
  `<p>Wassalamu’alaikum warahmatullahi wabarakatuh.</p>` +
  `<p><b>Panitia Kajian PPME Den Haag</b></p></div>`;

/** "Pendaftaran saya" link and rules, computed when the email is built. */
export interface ManageInfo {
  /** Absolute link to /e/<slug>/pendaftaran-saya; null when PUBLIC_APP_URL is not configured. */
  url: string | null;
  editable: boolean;
  /** Last moment a self-service change is possible (UTC ISO), when editable. */
  until: string | null;
  /** Payment confirmed: view only, changes via the committee. */
  paid: boolean;
  /** Committee address for changes that cannot be made online. */
  contact: string;
  /** This email was sent because the registrant changed the registration. */
  updated: boolean;
}

const box = (inner: string, accent = "#034EA2", bg = "#F0F5FC") =>
  `<div style="border-left:3px solid ${accent};background:${bg};padding:12px 16px;margin:18px 0;">${inner}</div>`;

const link = (url: string) => `<a href="${escapeHtml(url)}" style="color:#034EA2;font-weight:bold;">${escapeHtml(url)}</a>`;
const mail = (to: string) => `<a href="mailto:${escapeHtml(to)}" style="color:#034EA2;">${escapeHtml(to)}</a>`;

/** Notice at the top of a re-sent email after a self-service edit. */
function updatedNotice(m: ManageInfo | undefined) {
  if (!m?.updated) return "";
  return box(
    `<b>Data pendaftaran Anda telah diperbarui.</b> Email ini berisi data terbaru dan menggantikan email sebelumnya.`,
  );
}

/** How to view / change the registration. Paid: view only, changes by email to the committee. */
export function manageSection(m: ManageInfo | undefined, pending = false) {
  if (!m) return "";
  if (m.paid) {
    return box(
      `<b>Perubahan data pendaftaran</b><br>` +
        `Pembayaran Anda sudah dikonfirmasi, sehingga data pendaftaran tidak dapat lagi diubah sendiri. ` +
        `Jika ada data yang perlu diubah, silakan hubungi panitia melalui email ${mail(m.contact)} dengan menyebutkan nama pendaftar dan kode pembayaran Anda.` +
        (m.url ? `<br>Anda tetap dapat melihat pendaftaran Anda di ${link(m.url)}.` : ""),
      "#D97706",
      "#FFFBEB",
    );
  }
  if (m.editable && m.url) {
    const when = pending
      ? "sebelum pembayaran Anda dikonfirmasi panitia"
      : m.until
        ? `sampai ${escapeHtml(formatDateTime(m.until))} waktu Belanda`
        : "selama pendaftaran masih dibuka";
    return box(
      `<b>Lihat atau ubah pendaftaran</b><br>` +
        `Anda dapat melihat dan mengubah data pendaftaran (nama, nomor WhatsApp, serta data dan jumlah peserta) ${when} melalui:<br>` +
        `${link(m.url)}<br>` +
        `<small>Masuk dengan alamat email ini; kode akses akan dikirim ke email Anda. Alamat email dan status keanggotaan hanya dapat diubah melalui panitia (${mail(m.contact)}).</small>`,
    );
  }
  return box(
    `<b>Perubahan data pendaftaran</b><br>` +
      `Jika ada data yang perlu diubah, silakan hubungi panitia melalui email ${mail(m.contact)}.` +
      (m.url ? `<br>Lihat pendaftaran Anda di ${link(m.url)}.` : ""),
    "#94A3B8",
    "#F8FAFC",
  );
}

/** "Ketentuan pendaftaran": the same rules as on the public form (lib/rules.ts). */
export function rulesSection(e: EventInfo) {
  const items = registrationRules({
    maxFamily: e.max_family,
    priceCents: e.price_non_member_cents,
    payWindowHours: Math.round(e.pay_window_min / 60),
  })
    .map((r) => `<li>${r.parts.map((p) => (typeof p === "string" ? escapeHtml(p) : `<b>${escapeHtml(p.b)}</b>`)).join("")}</li>`)
    .join("");
  return `<h3>Ketentuan Pendaftaran</h3><ul>${items}</ul>`;
}

const eventDate = (e: EventInfo) =>
  `${formatLongDate(e.starts_at)}, ${formatTime(e.starts_at)}–${formatTime(e.ends_at)} waktu Belanda`;

export function confirmationEmail(args: {
  event: EventInfo;
  registrantName: string;
  participants: { name: string; ageGroup: string; category: string; cid: string }[];
  manage?: ManageInfo;
}) {
  const { event, registrantName, participants, manage } = args;
  const cards = participants
    .map(
      (p, i) =>
        `<div style="border:1px solid #ddd;padding:15px;margin:15px 0;border-radius:8px;">` +
        `<h3 style="margin:0 0 6px;">Peserta ${i + 1}: ${escapeHtml(p.name)}</h3>` +
        `<p style="margin:0;">Kelompok usia: ${escapeHtml(p.ageGroup)}<br><b>Kategori: ${escapeHtml(p.category)}</b></p>` +
        `<img src="cid:${p.cid}" width="200" height="200" alt="QR Code peserta ${i + 1}" style="display:block;margin:10px 0;">` +
        `<p style="margin:0;"><small>Tunjukkan QR Code ini kepada panitia saat check-in.</small></p>` +
        `</div>`,
    )
    .join("");

  const html = wrap(
    `<p>Yth. ${escapeHtml(registrantName)},</p>` +
      updatedNotice(manage) +
      `<p>Terima kasih telah mendaftarkan diri dan keluarga untuk mengikuti <b>${escapeHtml(event.title)}</b>.</p>` +
      `<p>Dengan ini kami mengonfirmasi bahwa pendaftaran Anda telah <b style="color:green;">DITERIMA</b>.</p>` +
      manageSection(manage) +
      `<h3>Informasi Acara</h3><ul>` +
      `<li><b>Acara:</b> ${escapeHtml(event.title)}${event.speaker ? " bersama " + escapeHtml(event.speaker) : ""}</li>` +
      (event.theme ? `<li><b>Tema:</b> ${escapeHtml(event.theme)}</li>` : "") +
      `<li><b>Hari/Tanggal:</b> ${escapeHtml(eventDate(event))}</li>` +
      `<li><b>Jumlah peserta:</b> ${participants.length} orang</li>` +
      `<li><b>Penyelenggara:</b> Panitia Kajian PPME Den Haag</li></ul>` +
      `<h3>Dukungan Infaq untuk Dakwah dan Kajian</h3>` +
      `<p>Kami mengajak Bapak/Ibu dan Saudara/i untuk turut mendukung kegiatan dakwah dan kajian Islam melalui infaq sukarela. Berapa pun nilainya, insyaAllah sangat berarti bagi keberlangsungan kegiatan kajian PPME Den Haag.</p>` +
      `<p><i>“Jagalah diri kalian dari api neraka walaupun hanya dengan (bersedekah) separuh kurma.”</i> <b>(HR. Bukhari dan Muslim)</b></p>` +
      `<p><b>Infaq ini sepenuhnya sukarela, tidak wajib dan tidak menjadi syarat pendaftaran maupun keikutsertaan dalam kajian.</b></p>` +
      `<h3>QR Code Peserta</h3><p>Berikut QR Code untuk masing-masing peserta yang telah terdaftar:</p>` +
      cards +
      `<p><b>Mohon diperhatikan:</b></p><ul>` +
      `<li>Simpan QR Code masing-masing peserta.</li>` +
      `<li>Tunjukkan QR Code kepada panitia saat check-in di lokasi acara.</li>` +
      `<li>QR Code hanya berisi kode tiket acak, bukan data pribadi Anda.</li></ul>` +
      rulesSection(event) +
      `<p>Terima kasih atas partisipasi Anda. Sampai bertemu di acara.</p>`,
  );
  return { subject: `${manage?.updated ? "Pembaruan " : ""}Konfirmasi Pendaftaran ${event.title} – ${formatLongDate(event.starts_at)}`, html };
}

export function paymentInstructionsEmail(args: {
  event: EventInfo;
  registrantName: string;
  people: number;
  amountCents: number;
  paymentCode: string;
  payDeadline: string;
  bank: BankInfo;
  manage?: ManageInfo;
}) {
  const a = args;
  const html = wrap(
    `<p>Yth. ${escapeHtml(a.registrantName)},</p>` +
      updatedNotice(a.manage) +
      `<p>Terima kasih telah mendaftar untuk <b>${escapeHtml(a.event.title)}</b>. Pendaftaran Anda sedang menunggu pembayaran.</p>` +
      `<h3>Informasi Pembayaran</h3>` +
      `<p>Jumlah peserta: <b>${a.people} orang</b><br>Total pembayaran: <b>${formatEuro(a.amountCents)}</b></p>` +
      `<p>Kode pembayaran:</p><h2 style="color:#034EA2;">${escapeHtml(a.paymentCode)}</h2>` +
      `<p><b>Transfer ke rekening berikut:</b><br>Nama pemilik rekening: <b>${escapeHtml(a.bank.accountName)}</b><br>IBAN: <b>${escapeHtml(a.bank.iban)}</b></p>` +
      `<p><b>Penting:</b> cantumkan kode pembayaran <b>${escapeHtml(a.paymentCode)}</b> sebagai keterangan transfer.</p>` +
      `<p>Batas pembayaran: <b>${escapeHtml(formatDateTime(a.payDeadline))} waktu Belanda</b>.</p>` +
      `<p>QR Code akan dikirim melalui email setelah panitia mengonfirmasi pembayaran.</p>` +
      manageSection(a.manage, true) +
      rulesSection(a.event),
  );
  return { subject: `${a.manage?.updated ? "Pembaruan " : ""}Instruksi Pembayaran ${a.event.title}`, html };
}

export function reminderEmail(args: {
  event: EventInfo;
  registrantName: string;
  amountCents: number;
  paymentCode: string;
  payDeadline: string;
  bank: BankInfo;
  manage?: ManageInfo;
}) {
  const a = args;
  const html = wrap(
    `<p>Yth. ${escapeHtml(a.registrantName)},</p>` +
      `<p>Ini adalah pengingat bahwa pembayaran pendaftaran Anda belum kami terima.</p>` +
      `<p>Total pembayaran: <b>${formatEuro(a.amountCents)}</b><br>Kode pembayaran: <b>${escapeHtml(a.paymentCode)}</b><br>` +
      `Nama pemilik rekening: <b>${escapeHtml(a.bank.accountName)}</b><br>IBAN: <b>${escapeHtml(a.bank.iban)}</b></p>` +
      `<p>Batas pembayaran: <b>${escapeHtml(formatDateTime(a.payDeadline))} waktu Belanda</b>.</p>` +
      `<p>Mohon cantumkan kode pembayaran sebagai keterangan transfer. QR Code akan dikirim setelah pembayaran dikonfirmasi panitia.</p>` +
      manageSection(a.manage, true),
  );
  return { subject: `Pengingat Pembayaran ${a.event.title}`, html };
}

export function expiredEmail(args: { event: EventInfo; registrantName: string; paymentCode: string }) {
  const a = args;
  const html = wrap(
    `<p>Yth. ${escapeHtml(a.registrantName)},</p>` +
      `<p>Mohon maaf, batas waktu pembayaran pendaftaran Anda telah berakhir.</p>` +
      `<p>Kode pembayaran: <b>${escapeHtml(a.paymentCode)}</b></p>` +
      `<p>Pendaftaran Anda telah kedaluwarsa dan kuota telah dilepaskan. Jika masih ingin mengikuti kajian, silakan mendaftar kembali melalui formulir.</p>` +
      `<p>Pembayaran untuk pendaftaran yang sudah kedaluwarsa tidak dapat diaktifkan kembali. Jika Anda sudah terlanjur membayar, silakan hubungi panitia.</p>`,
  );
  return { subject: `Pendaftaran ${a.event.title} Kedaluwarsa`, html };
}
