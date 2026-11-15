import {
  BanknotesIcon,
  BuildingLibraryIcon,
  CheckCircleIcon,
  ClockIcon,
  EnvelopeIcon,
  HashtagIcon,
  HeartIcon,
  IdentificationIcon,
  PencilSquareIcon,
  QrCodeIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";

import { Link } from "react-router";

import { Callout, Eyebrow, Logo, buttonClass } from "~/components/ui";
import { formatDateTime, formatEuro } from "~/lib/format";
import { EventDetailRow } from "./EventDetailRow";

export type SuccessResult =
  | { ok: true; kind: "pending_membership"; people: number; email: string }
  | { ok: true; kind: "accepted"; people: number; email: string; member: boolean }
  | {
      ok: true;
      kind: "pending_payment";
      people: number;
      email: string;
      paymentCode: string;
      amountCents: number;
      payDeadline: string;
      bank: { accountName: string; iban: string };
    };

/** Shown after a successful submit: confirmation (members) or payment instructions (non-members). */
export function SuccessPanel({
  result,
  eventTitle,
  manageUrl,
  infaqUrl,
}: {
  result: SuccessResult;
  eventTitle: string;
  manageUrl: string;
  /** Voluntary infaq payment link of the event; the infaq block is left out when empty. */
  infaqUrl?: string | null;
}) {
  const accepted = result.kind === "accepted";
  const membership = result.kind === "pending_membership";
  return (
    <>
      <header className="px-5 pt-7 sm:px-8 sm:pt-10 lg:px-10 lg:pt-12">
        <div className="flex items-start justify-between gap-4 sm:gap-8">
          <div className="min-w-0">
            <Eyebrow className={`flex items-center gap-2 ${accepted ? "text-emerald-700" : "text-amber-700"}`}>
              {accepted ? (
                <CheckCircleIcon className="size-4" aria-hidden="true" />
              ) : (
                <ClockIcon className="size-4" aria-hidden="true" />
              )}
              {accepted ? "Pendaftaran berhasil" : membership ? "Pendaftaran dicatat" : "Langkah terakhir"}
            </Eyebrow>
            <h1 className="text-gradient-brand mt-3 text-[1.75rem] leading-[1.12] font-bold tracking-tight text-balance sm:text-4xl">
              {accepted
                ? "Pendaftaran diterima"
                : membership
                  ? "Pendaftaran dicatat – menunggu validasi keanggotaan"
                  : "Pendaftaran dicatat – menunggu pembayaran"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">{eventTitle}</p>
          </div>
          <Logo className="h-11 w-auto sm:h-14 lg:h-16" />
        </div>
      </header>

      {result.kind === "pending_membership" ? (
        <>
          <dl className="mt-8 grid gap-px border-y border-slate-200/80 bg-slate-200/80 sm:grid-cols-2">
            <EventDetailRow icon={UsersIcon} label="Jumlah peserta" value={`${result.people} orang`} sub="Gratis untuk anggota" />
            <EventDetailRow
              icon={EnvelopeIcon}
              label="Dikirim ke"
              value={<span className="break-all">{result.email}</span>}
              sub="Periksa juga folder spam"
            />
          </dl>
          <div className="px-5 py-8 sm:px-8 lg:px-10">
            <Callout tone="warning" icon={IdentificationIcon} title="QR Code dikirim setelah keanggotaan divalidasi">
              <p>
                Panitia akan memeriksa keanggotaan Anda di daftar anggota PPME Den Haag. Setelah divalidasi, email
                konfirmasi beserta QR Code setiap peserta dikirim ke{" "}
                <span className="font-semibold">{result.email}</span>. Pemberitahuan bahwa pendaftaran Anda diterima
                sudah dikirim ke alamat yang sama.
              </p>
            </Callout>
          </div>
        </>
      ) : result.kind === "accepted" ? (
        <>
          <dl className="mt-8 grid gap-px border-y border-slate-200/80 bg-slate-200/80 sm:grid-cols-2">
            <EventDetailRow
              icon={UsersIcon}
              label="Jumlah peserta"
              value={`${result.people} orang`}
              sub={result.member ? "Gratis untuk anggota" : "Gratis"}
            />
            <EventDetailRow
              icon={EnvelopeIcon}
              label="Dikirim ke"
              value={<span className="break-all">{result.email}</span>}
              sub="Periksa juga folder spam"
            />
          </dl>
          <div className="px-5 py-8 sm:px-8 lg:px-10">
            <Callout tone="success" icon={QrCodeIcon} title="QR Code dalam perjalanan">
              <p>
                Pendaftaran Anda sudah selesai, tidak ada pembayaran yang diperlukan. Email konfirmasi beserta QR Code
                setiap peserta dikirim ke <span className="font-semibold">{result.email}</span> dalam beberapa menit
                (maksimal sekitar 10 menit). Tunjukkan QR Code saat check-in; setiap kode hanya dapat digunakan satu kali.
              </p>
            </Callout>
          </div>
        </>
      ) : (
        <>
          <div className="mt-8 border-y border-slate-200/80 bg-brand-50/50 px-5 py-6 sm:px-8 lg:px-10">
            <Eyebrow>Jumlah yang harus ditransfer</Eyebrow>
            <p className="mt-2 text-4xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-5xl">
              {formatEuro(result.amountCents)}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Untuk {result.people} orang · sebelum{" "}
              <span className="font-semibold text-slate-900">{formatDateTime(result.payDeadline)} waktu Belanda</span>
            </p>
          </div>
          <dl className="grid gap-px border-b border-slate-200/80 bg-slate-200/80 sm:grid-cols-3">
            <EventDetailRow
              icon={HashtagIcon}
              label="Kode pembayaran"
              value={<span className="font-mono text-lg tracking-wide text-brand">{result.paymentCode}</span>}
              sub="Wajib sebagai keterangan transfer"
            />
            <EventDetailRow icon={BuildingLibraryIcon} label="Nama rekening" value={result.bank.accountName} />
            <EventDetailRow
              icon={BanknotesIcon}
              label="IBAN"
              value={<span className="font-mono break-all">{result.bank.iban}</span>}
            />
          </dl>
          <div className="px-5 py-8 sm:px-8 lg:px-10">
            <h2 className="text-sm font-semibold text-slate-900">Langkah berikutnya</h2>
            <ol className="mt-4 space-y-4">
              <Step n={1}>
                Transfer <span className="font-semibold text-slate-900">{formatEuro(result.amountCents)}</span> dan{" "}
                <span className="font-semibold text-slate-900">cantumkan kode pembayaran sebagai keterangan transfer.</span>
              </Step>
              <Step n={2}>
                Instruksi ini juga dikirim ke <span className="font-semibold text-slate-900 break-all">{result.email}</span>.
              </Step>
              <Step n={3}>QR Code dikirim setelah panitia mengonfirmasi pembayaran.</Step>
            </ol>
          </div>
        </>
      )}
      {infaqUrl ? <InfaqSection url={infaqUrl} /> : null}
      <div className="border-t border-slate-200/80 bg-slate-50/70 px-5 py-5 sm:px-8 lg:px-10">
        <p className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {result.kind === "accepted" || result.kind === "pending_membership"
              ? "Perlu mengubah data peserta? Anda dapat melakukannya sendiri selama pendaftaran masih dibuka."
              : "Perlu mengubah data peserta? Anda dapat melakukannya sendiri sebelum pembayaran dikonfirmasi."}
          </span>
          <Link to={manageUrl} className={buttonClass("secondary", "sm", "self-start sm:self-auto")}>
            <PencilSquareIcon className="size-4" aria-hidden="true" />
            Pendaftaran Saya
          </Link>
        </p>
      </div>
    </>
  );
}

/** Voluntary infaq block (same wording as the confirmation email). Opens the ING payment request in a new tab. */
function InfaqSection({ url }: { url: string }) {
  return (
    <div className="border-t border-slate-200/80 px-5 py-8 sm:px-8 lg:px-10">
      <Callout tone="neutral" icon={HeartIcon} title="Dukungan Infaq untuk Dakwah dan Kajian">
        <p>
          Kami mengajak Bapak/Ibu dan Saudara/i untuk turut mendukung kegiatan dakwah dan kajian Islam melalui infaq sukarela.
          Berapa pun nilainya, insyaAllah sangat berarti bagi keberlangsungan kegiatan kajian PPME Den Haag.
        </p>
        <p className="mt-3 italic">
          “Jagalah diri kalian dari api neraka walaupun hanya dengan (bersedekah) separuh kurma.”{" "}
          <span className="font-semibold not-italic">(HR. Bukhari dan Muslim)</span>
        </p>
        <p className="mt-4">
          <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "md")}>
            <HeartIcon className="size-4" aria-hidden="true" />
            Berikan Infaq
          </a>
        </p>
        <p className="mt-3 font-semibold">
          Infaq ini sepenuhnya sukarela, tidak wajib dan tidak menjadi syarat pendaftaran maupun keikutsertaan dalam kajian.
        </p>
      </Callout>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm leading-relaxed text-slate-600">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-brand-200 bg-white font-mono text-xs font-semibold text-brand">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}
