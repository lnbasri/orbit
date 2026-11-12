// Email bodies ported from the Apps Script version (Code.gs), with the stray markup fixed (B9).
import { formatDateTime, formatEuro, formatLongDate, formatTime } from "../format";

export interface EventInfo {
  title: string;
  speaker: string | null;
  theme: string | null;
  starts_at: string;
  ends_at: string;
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

const eventDate = (e: EventInfo) =>
  `${formatLongDate(e.starts_at)}, ${formatTime(e.starts_at)}–${formatTime(e.ends_at)} waktu Belanda`;

export function confirmationEmail(args: {
  event: EventInfo;
  registrantName: string;
  participants: { name: string; birthYear: number; category: string; cid: string }[];
}) {
  const { event, registrantName, participants } = args;
  const cards = participants
    .map(
      (p, i) =>
        `<div style="border:1px solid #ddd;padding:15px;margin:15px 0;border-radius:8px;">` +
        `<h3 style="margin:0 0 6px;">Peserta ${i + 1}: ${escapeHtml(p.name)}</h3>` +
        `<p style="margin:0;">Tahun lahir: ${escapeHtml(p.birthYear)}<br><b>Kategori: ${escapeHtml(p.category)}</b></p>` +
        `<img src="cid:${p.cid}" width="200" height="200" alt="QR Code peserta ${i + 1}" style="display:block;margin:10px 0;">` +
        `<p style="margin:0;"><small>Tunjukkan QR Code ini kepada panitia saat check-in.</small></p>` +
        `</div>`,
    )
    .join("");

  const html = wrap(
    `<p>Yth. ${escapeHtml(registrantName)},</p>` +
      `<p>Terima kasih telah mendaftarkan diri dan keluarga untuk mengikuti <b>${escapeHtml(event.title)}</b>.</p>` +
      `<p>Dengan ini kami mengonfirmasi bahwa pendaftaran Anda telah <b style="color:green;">DITERIMA</b>.</p>` +
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
      `<li>Setiap QR Code hanya dapat digunakan satu kali untuk check-in.</li>` +
      `<li>QR Code hanya berisi kode tiket acak, bukan data pribadi Anda.</li></ul>` +
      `<p>Terima kasih atas partisipasi Anda. Sampai bertemu di acara.</p>`,
  );
  return { subject: `Konfirmasi Pendaftaran ${event.title} – ${formatLongDate(event.starts_at)}`, html };
}

export function paymentInstructionsEmail(args: {
  event: EventInfo;
  registrantName: string;
  people: number;
  amountCents: number;
  paymentCode: string;
  payDeadline: string;
  bank: BankInfo;
}) {
  const a = args;
  const html = wrap(
    `<p>Yth. ${escapeHtml(a.registrantName)},</p>` +
      `<p>Terima kasih telah mendaftar untuk <b>${escapeHtml(a.event.title)}</b>. Pendaftaran Anda sedang menunggu pembayaran.</p>` +
      `<h3>Informasi Pembayaran</h3>` +
      `<p>Jumlah peserta: <b>${a.people} orang</b><br>Total pembayaran: <b>${formatEuro(a.amountCents)}</b></p>` +
      `<p>Kode pembayaran:</p><h2 style="color:#034EA2;">${escapeHtml(a.paymentCode)}</h2>` +
      `<p><b>Transfer ke rekening berikut:</b><br>Nama pemilik rekening: <b>${escapeHtml(a.bank.accountName)}</b><br>IBAN: <b>${escapeHtml(a.bank.iban)}</b></p>` +
      `<p><b>Penting:</b> cantumkan kode pembayaran <b>${escapeHtml(a.paymentCode)}</b> sebagai keterangan transfer.</p>` +
      `<p>Batas pembayaran: <b>${escapeHtml(formatDateTime(a.payDeadline))} waktu Belanda</b>.</p>` +
      `<p>QR Code akan dikirim melalui email setelah panitia mengonfirmasi pembayaran.</p>`,
  );
  return { subject: `Instruksi Pembayaran ${a.event.title}`, html };
}

export function reminderEmail(args: {
  event: EventInfo;
  registrantName: string;
  amountCents: number;
  paymentCode: string;
  payDeadline: string;
  bank: BankInfo;
}) {
  const a = args;
  const html = wrap(
    `<p>Yth. ${escapeHtml(a.registrantName)},</p>` +
      `<p>Ini adalah pengingat bahwa pembayaran pendaftaran Anda belum kami terima.</p>` +
      `<p>Total pembayaran: <b>${formatEuro(a.amountCents)}</b><br>Kode pembayaran: <b>${escapeHtml(a.paymentCode)}</b><br>` +
      `Nama pemilik rekening: <b>${escapeHtml(a.bank.accountName)}</b><br>IBAN: <b>${escapeHtml(a.bank.iban)}</b></p>` +
      `<p>Batas pembayaran: <b>${escapeHtml(formatDateTime(a.payDeadline))} waktu Belanda</b>.</p>` +
      `<p>Mohon cantumkan kode pembayaran sebagai keterangan transfer. QR Code akan dikirim setelah pembayaran dikonfirmasi panitia.</p>`,
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
