// "Ketentuan pendaftaran": one source for the public form (HeaderSection) and the registration emails.
import { formatEuro } from "./format";

/** A rule is a list of text parts; `{ b }` parts are emphasised (bold). */
export type RulePart = string | { b: string };

export type RuleKey = "group" | "quota" | "closed" | "fee" | "qr" | "email" | "once";

export interface RegistrationRule {
  key: RuleKey;
  parts: RulePart[];
}

export interface RuleEventInfo {
  maxFamily: number;
  priceCents: number;
  payWindowHours: number;
}

export function registrationRules(e: RuleEventInfo): RegistrationRule[] {
  return [
    { key: "group", parts: [`Pendaftaran perorangan atau keluarga, maksimal ${e.maxFamily} orang termasuk pendaftar.`] },
    { key: "quota", parts: ["Pendaftaran ditolak bila kuota tidak mencukupi untuk seluruh peserta yang didaftarkan."] },
    {
      key: "closed",
      parts: [
        { b: "Pendaftaran ditutup otomatis apabila kuota peserta sudah terpenuhi." },
        " Setelah kuota dinyatakan penuh, panitia tidak melayani telepon maupun email, dan tidak menerima keluhan dari calon peserta (jamaah) yang sudah mendaftar tetapi belum menerima konfirmasi atau QR Code.",
      ],
    },
    {
      key: "fee",
      parts: [
        "Anggota PPME Den Haag gratis. Non-anggota: ",
        { b: `${formatEuro(e.priceCents)} per orang` },
        ", dibayar dalam ",
        { b: `${e.payWindowHours} jam` },
        " setelah mendaftar.",
      ],
    },
    { key: "qr", parts: ["QR Code dikirim lewat email setelah pendaftaran diterima atau pembayaran dikonfirmasi."] },
    { key: "email", parts: [{ b: "Pastikan alamat email Anda benar, dan periksa juga folder spam." }] },
    { key: "once", parts: ["Setiap QR Code hanya dapat digunakan satu kali saat check-in."] },
  ];
}
