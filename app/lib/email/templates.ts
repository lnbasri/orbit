// Email bodies ported from the Apps Script version (Code.gs), with the stray markup fixed (B9).
// Layout and building blocks live in ./layout (same look as the login-code email).
import { formatDateTime, formatEuro, formatHijriDate, formatLongDate, formatTime } from "../format";
import { registrationRules } from "../rules";
import {
  BRAND,
  FONT,
  bullets,
  buttonLink,
  callout,
  codePanel,
  detailTable,
  emailShell,
  escapeHtml,
  heading,
  para,
} from "./layout";

export { escapeHtml };

/** Voluntary infaq payment request (ING), shown as a button in the confirmation email. */
const INFAQ_PAYMENT_URL = "https://www.ing.nl/payreq/m/?trxid=pGFVuaic76PdDsKuFNeHD4wkJ5edNwsY";

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

/** Fields every registration email needs for the shared layout. */
interface Common {
  /** Committee address shown in the footer. */
  contact: string;
  /** Absolute origin for the logo (PUBLIC_APP_URL); text fallback when missing. */
  origin?: string;
}

const link = (url: string) => `<a href="${escapeHtml(url)}" style="color:${BRAND};font-weight:bold;">${escapeHtml(url)}</a>`;
const mail = (to: string) => `<a href="mailto:${escapeHtml(to)}" style="color:${BRAND};">${escapeHtml(to)}</a>`;
const small = (html: string) => `<span style="font-size:12px;line-height:19px;color:#64748B;">${html}</span>`;

/** Notice at the top of a re-sent email after a self-service edit. */
function updatedNotice(m: ManageInfo | undefined) {
  if (!m?.updated) return "";
  return callout(
    `<strong>Data pendaftaran Anda telah diperbarui.</strong> Email ini berisi data terbaru dan menggantikan email sebelumnya.`,
  );
}

/** How to view / change the registration. Paid: view only, changes by email to the committee. */
export function manageSection(m: ManageInfo | undefined, pending = false) {
  if (!m) return "";
  if (m.paid) {
    return callout(
      `<strong>Perubahan data pendaftaran</strong><br>` +
        `Pembayaran Anda sudah dikonfirmasi, sehingga data pendaftaran tidak dapat lagi diubah sendiri. ` +
        `Jika ada data yang perlu diubah, silakan hubungi panitia melalui email ${mail(m.contact)} dengan menyebutkan nama pendaftar dan kode pembayaran Anda.` +
        (m.url ? `<br>Anda tetap dapat melihat pendaftaran Anda di ${link(m.url)}.` : ""),
      "#D97706",
      "#FFFBEB",
      "#78350F",
    );
  }
  if (m.editable && m.url) {
    const when = pending
      ? "sebelum pembayaran Anda dikonfirmasi panitia"
      : m.until
        ? `sampai ${escapeHtml(formatDateTime(m.until))} waktu Belanda`
        : "selama pendaftaran masih dibuka";
    return callout(
      `<strong>Lihat atau ubah pendaftaran</strong><br>` +
        `Anda dapat melihat dan mengubah data pendaftaran (nama, nomor WhatsApp, serta data dan jumlah peserta) ${when} melalui tombol berikut:` +
        buttonLink("Lihat atau Ubah Pendaftaran", m.url) +
        small(
          `Masuk dengan alamat email ini; kode akses akan dikirim ke email Anda. Alamat email dan status keanggotaan hanya dapat diubah melalui panitia (${mail(m.contact)}).`,
        ),
    );
  }
  return callout(
    `<strong>Perubahan data pendaftaran</strong><br>` +
      `Jika ada data yang perlu diubah, silakan hubungi panitia melalui email ${mail(m.contact)}.` +
      (m.url ? `<br>Lihat pendaftaran Anda di ${link(m.url)}.` : ""),
    "#94A3B8",
    "#F8FAFC",
    "#334155",
  );
}

/** "Ketentuan pendaftaran": the same rules as on the public form (lib/rules.ts). */
export function rulesSection(e: EventInfo) {
  const items = registrationRules({
    maxFamily: e.max_family,
    priceCents: e.price_non_member_cents,
    payWindowHours: Math.round(e.pay_window_min / 60),
  }).map((r) =>
    r.parts.map((p) => (typeof p === "string" ? escapeHtml(p) : `<strong>${escapeHtml(p.b)}</strong>`)).join(""),
  );
  return heading("Ketentuan Pendaftaran") + bullets(items);
}

const eventDate = (e: EventInfo) => {
  const hijri = formatHijriDate(e.starts_at);
  return `${formatLongDate(e.starts_at)}${hijri ? ` (${hijri})` : ""}, ${formatTime(e.starts_at)}–${formatTime(e.ends_at)} waktu Belanda`;
};

const greeting = (name: string) => para(`Yth. ${escapeHtml(name)},`, "0 0 12px 0");

export function confirmationEmail(
  args: {
    event: EventInfo;
    registrantName: string;
    participants: { name: string; ageGroup: string; category: string; cid: string }[];
    /** Links to add the event to Google Calendar / Outlook.com (the .ics file is attached by the sender). */
    calendar?: { google: string; outlook: string };
    /** Member: the QR codes were issued because the committee validated the membership. */
    member?: boolean;
    manage?: ManageInfo;
  } & Common,
) {
  const { event, registrantName, participants, calendar, member, manage, contact, origin } = args;
  const cards = participants
    .map(
      (p, i) =>
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px 0;border:1px solid #E2E8F0;">` +
        `<tr><td class="qr" style="padding:14px 16px;font-family:${FONT};">` +
        `<p style="margin:0 0 2px 0;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${BRAND};">Peserta ${i + 1}</p>` +
        `<p style="margin:0 0 4px 0;font-size:16px;line-height:24px;font-weight:700;color:#0F172A;">${escapeHtml(p.name)}</p>` +
        `<p style="margin:0 0 12px 0;font-size:13px;line-height:20px;color:#475569;">Kelompok usia: ${escapeHtml(p.ageGroup)} &middot; <strong style="color:#0F172A;">${escapeHtml(p.category)}</strong></p>` +
        `<img src="cid:${p.cid}" width="200" height="200" alt="QR Code peserta ${i + 1}" style="display:block;width:200px;height:200px;border:1px solid #E2E8F0;">` +
        `<p style="margin:10px 0 0 0;font-size:12px;line-height:19px;color:#64748B;">Tunjukkan QR Code ini kepada panitia saat check-in.</p>` +
        `</td></tr></table>`,
    )
    .join("");

  const info: [string, string][] = [
    ["Acara", `${event.title}${event.speaker ? " bersama " + event.speaker : ""}`],
    ...(event.theme ? ([["Tema", event.theme]] as [string, string][]) : []),
    ["Hari/Tanggal", eventDate(event)],
    ["Jumlah peserta", `${participants.length} orang`],
    ["Penyelenggara", "Panitia Kajian PPME Den Haag"],
  ];

  const body =
    greeting(registrantName) +
    updatedNotice(manage) +
    para(`Terima kasih telah mendaftarkan diri dan keluarga untuk mengikuti <strong>${escapeHtml(event.title)}</strong>.`) +
    callout(
      member
        ? `<strong style="color:#14532D;">Keanggotaan Anda telah divalidasi dan pendaftaran Anda DITERIMA.</strong> QR Code untuk check-in ada di bawah.`
        : `<strong style="color:#14532D;">Pendaftaran Anda telah DITERIMA.</strong> QR Code untuk check-in ada di bawah.`,
      "#16A34A",
      "#F0FDF4",
      "#166534",
    ) +
    manageSection(manage) +
    heading("Informasi Acara") +
    detailTable(info) +
    calendarSection(calendar) +
    heading("QR Code Peserta") +
    para("Berikut QR Code untuk masing-masing peserta yang telah terdaftar:", "0 0 14px 0") +
    cards +
    para("<strong>Mohon diperhatikan:</strong>", "0 0 6px 0") +
    bullets([
      "Simpan QR Code masing-masing peserta.",
      "Tunjukkan QR Code kepada panitia saat check-in di lokasi acara.",
      "QR Code hanya berisi kode tiket acak, bukan data pribadi Anda.",
    ]) +
    heading("Dukungan Infaq untuk Dakwah dan Kajian") +
    para(
      "Kami mengajak Bapak/Ibu dan Saudara/i untuk turut mendukung kegiatan dakwah dan kajian Islam melalui infaq sukarela. Berapa pun nilainya, insyaAllah sangat berarti bagi keberlangsungan kegiatan kajian PPME Den Haag.",
    ) +
    para(
      "<em>“Jagalah diri kalian dari api neraka walaupun hanya dengan (bersedekah) separuh kurma.”</em> <strong>(HR. Bukhari dan Muslim)</strong>",
    ) +
    buttonLink("Berikan Infaq", INFAQ_PAYMENT_URL) +
    para(
      "<strong>Infaq ini sepenuhnya sukarela, tidak wajib dan tidak menjadi syarat pendaftaran maupun keikutsertaan dalam kajian.</strong>",
    ) +
    rulesSection(event) +
    para("Terima kasih atas partisipasi Anda. Sampai bertemu di acara.", "8px 0 0 0");

  const subject = `${manage?.updated ? "Pembaruan " : ""}Konfirmasi Pendaftaran ${event.title} – ${formatLongDate(event.starts_at)}`;
  const html = emailShell({
    subject,
    label: "Konfirmasi Pendaftaran",
    eyebrow: manage?.updated ? "Pendaftaran diperbarui" : "Pendaftaran diterima",
    title: "Pendaftaran Anda diterima",
    preheader: `${event.title}, ${formatLongDate(event.starts_at)}. QR Code check-in untuk ${participants.length} peserta ada di email ini.`,
    body,
    origin,
    contact,
  });
  return { subject, html };
}

/** "Simpan di kalender": web links plus a pointer to the attached .ics file. Left out when no links are given. */
function calendarSection(c: { google: string; outlook: string } | undefined) {
  if (!c) return "";
  const item = (label: string, url: string) =>
    `<a href="${escapeHtml(url)}" target="_blank" style="color:${BRAND};font-weight:bold;">${escapeHtml(label)}</a>`;
  return (
    heading("Simpan di Kalender") +
    para(
      `Tambahkan acara ini ke kalender Anda: ${item("Google Calendar", c.google)} &middot; ${item("Outlook.com", c.outlook)}.`,
      "0 0 6px 0",
    ) +
    para(
      small(
        "Untuk Apple Calendar, Outlook di komputer atau aplikasi kalender lain, buka lampiran <strong>kajian-ppme-den-haag.ics</strong> pada email ini. Pengingat otomatis diatur 1 hari sebelum acara.",
      ),
      "0 0 8px 0",
    )
  );
}

/** Payment code panel + bank details, shared by the payment instructions and the reminder. */
function paymentBlock(a: {
  paymentCode: string;
  amountCents: number;
  payDeadline: string;
  bank: BankInfo;
  people?: number;
}) {
  const rows: [string, string][] = [
    ...(a.people ? ([["Jumlah peserta", `${a.people} orang`]] as [string, string][]) : []),
    ["Total pembayaran", formatEuro(a.amountCents)],
    ["Nama pemilik rekening", a.bank.accountName],
    ["IBAN", a.bank.iban],
    ["Batas pembayaran", `${formatDateTime(a.payDeadline)} waktu Belanda`],
  ];
  return (
    codePanel(
      "Kode pembayaran Anda",
      a.paymentCode,
      `Cantumkan kode ini sebagai <strong style="color:#0F172A;">keterangan transfer</strong>`,
    ) + detailTable(rows)
  );
}

export function paymentInstructionsEmail(
  args: {
    event: EventInfo;
    registrantName: string;
    people: number;
    amountCents: number;
    paymentCode: string;
    payDeadline: string;
    bank: BankInfo;
    manage?: ManageInfo;
  } & Common,
) {
  const a = args;
  const body =
    greeting(a.registrantName) +
    updatedNotice(a.manage) +
    para(
      `Terima kasih telah mendaftar untuk <strong>${escapeHtml(a.event.title)}</strong>. Pendaftaran Anda sedang menunggu pembayaran.`,
    ) +
    paymentBlock(a) +
    para("QR Code akan dikirim melalui email setelah panitia mengonfirmasi pembayaran.", "14px 0") +
    manageSection(a.manage, true) +
    rulesSection(a.event);
  const subject = `${a.manage?.updated ? "Pembaruan " : ""}Instruksi Pembayaran ${a.event.title}`;
  const html = emailShell({
    subject,
    label: "Instruksi Pembayaran",
    eyebrow: a.manage?.updated ? "Pendaftaran diperbarui" : "Menunggu pembayaran",
    title: "Instruksi pembayaran",
    preheader: `Kode pembayaran ${a.paymentCode}. Total ${formatEuro(a.amountCents)}, bayar sebelum ${formatDateTime(a.payDeadline)} waktu Belanda.`,
    body,
    origin: a.origin,
    contact: a.contact,
  });
  return { subject, html };
}

export function reminderEmail(
  args: {
    event: EventInfo;
    registrantName: string;
    amountCents: number;
    paymentCode: string;
    payDeadline: string;
    bank: BankInfo;
    manage?: ManageInfo;
  } & Common,
) {
  const a = args;
  const body =
    greeting(a.registrantName) +
    para("Ini adalah pengingat bahwa pembayaran pendaftaran Anda belum kami terima.") +
    paymentBlock(a) +
    para("QR Code akan dikirim setelah pembayaran dikonfirmasi panitia.", "14px 0") +
    manageSection(a.manage, true);
  const subject = `Pengingat Pembayaran ${a.event.title}`;
  const html = emailShell({
    subject,
    label: "Pengingat Pembayaran",
    eyebrow: "Pengingat",
    title: "Pembayaran belum kami terima",
    preheader: `Kode pembayaran ${a.paymentCode}. Batas pembayaran ${formatDateTime(a.payDeadline)} waktu Belanda.`,
    body,
    origin: a.origin,
    contact: a.contact,
  });
  return { subject, html };
}

export function expiredEmail(args: { event: EventInfo; registrantName: string; paymentCode: string } & Common) {
  const a = args;
  const body =
    greeting(a.registrantName) +
    para("Mohon maaf, batas waktu pembayaran pendaftaran Anda telah berakhir.") +
    detailTable([["Kode pembayaran", a.paymentCode]]) +
    callout(
      `Pendaftaran Anda telah kedaluwarsa dan kuota telah dilepaskan. Jika masih ingin mengikuti kajian, silakan mendaftar kembali melalui formulir.`,
      "#94A3B8",
      "#F8FAFC",
      "#334155",
    ) +
    para(
      "Pembayaran untuk pendaftaran yang sudah kedaluwarsa tidak dapat diaktifkan kembali. Jika Anda sudah terlanjur membayar, silakan hubungi panitia.",
    );
  const subject = `Pendaftaran ${a.event.title} Kedaluwarsa`;
  const html = emailShell({
    subject,
    label: "Pendaftaran Kedaluwarsa",
    eyebrow: "Kedaluwarsa",
    title: "Pendaftaran kedaluwarsa",
    preheader: `Batas waktu pembayaran untuk kode ${a.paymentCode} telah berakhir.`,
    body,
    origin: a.origin,
    contact: a.contact,
  });
  return { subject, html };
}

/** Member registration received; the QR code follows once the committee has validated the membership. */
export function membershipPendingEmail(
  args: {
    event: EventInfo;
    registrantName: string;
    people: number;
    manage?: ManageInfo;
  } & Common,
) {
  const { event, registrantName, people, manage, contact, origin } = args;
  const info: [string, string][] = [
    ["Acara", `${event.title}${event.speaker ? " bersama " + event.speaker : ""}`],
    ["Hari/Tanggal", eventDate(event)],
    ["Jumlah peserta", `${people} orang`],
    ["Keanggotaan", "Anggota PPME Den Haag (menunggu validasi panitia)"],
  ];
  const body =
    greeting(registrantName) +
    updatedNotice(manage) +
    para(`Terima kasih telah mendaftarkan diri dan keluarga untuk mengikuti <strong>${escapeHtml(event.title)}</strong>.`) +
    callout(
      `<strong>Pendaftaran Anda telah kami terima dan sedang menunggu validasi keanggotaan.</strong><br>` +
        `Panitia akan memeriksa keanggotaan Anda di daftar anggota PPME Den Haag. <strong>QR Code untuk check-in akan dikirim melalui email setelah keanggotaan Anda divalidasi.</strong>`,
    ) +
    detailTable(info) +
    para(
      "Apabila keanggotaan tidak dapat dipastikan, panitia/pengurus PPME Den Haag berhak membatalkan pendaftaran. Dalam hal ini Bapak/Ibu tetap dapat mendaftar kembali sebagai non-anggota selama kuota masih tersedia.",
      "14px 0",
    ) +
    manageSection(manage) +
    rulesSection(event);
  const subject = `${manage?.updated ? "Pembaruan " : ""}Pendaftaran ${event.title} Diterima – Menunggu Validasi Keanggotaan`;
  const html = emailShell({
    subject,
    label: "Menunggu Validasi",
    eyebrow: manage?.updated ? "Pendaftaran diperbarui" : "Menunggu validasi",
    title: "Menunggu validasi keanggotaan",
    preheader: `Pendaftaran Anda diterima. QR Code dikirim setelah panitia memvalidasi keanggotaan Anda.`,
    body,
    origin,
    contact,
  });
  return { subject, html };
}
