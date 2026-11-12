import {
  BanknotesIcon,
  BuildingLibraryIcon,
  CheckCircleIcon,
  ClockIcon,
  EnvelopeIcon,
  HashtagIcon,
  QrCodeIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";

import { Callout, Eyebrow, Logo } from "~/components/ui";
import { formatDateTime, formatEuro } from "~/lib/format";
import { EventDetailRow } from "./EventDetailRow";

export type SuccessResult =
  | { ok: true; kind: "accepted"; people: number; email: string }
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
export function SuccessPanel({ result, eventTitle }: { result: SuccessResult; eventTitle: string }) {
  const accepted = result.kind === "accepted";
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
              {accepted ? "Pendaftaran berhasil" : "Langkah terakhir"}
            </Eyebrow>
            <h1 className="text-gradient-brand mt-3 text-[1.75rem] leading-[1.12] font-bold tracking-tight text-balance sm:text-4xl">
              {accepted ? "Pendaftaran diterima" : "Pendaftaran dicatat – menunggu pembayaran"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">{eventTitle}</p>
          </div>
          <Logo className="h-11 w-auto sm:h-14 lg:h-16" />
        </div>
      </header>

      {result.kind === "accepted" ? (
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
            <Callout tone="success" icon={QrCodeIcon} title="QR Code dalam perjalanan">
              <p>
                Email konfirmasi beserta QR Code setiap peserta dikirim ke{" "}
                <span className="font-semibold">{result.email}</span>. Tunjukkan QR Code saat check-in; setiap kode hanya
                dapat digunakan satu kali.
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
    </>
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
