import { useEffect, useState } from "react";
import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import {
  ArrowLeftIcon,
  ClipboardDocumentCheckIcon,
  PaperAirplaneIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";

import { Turnstile } from "~/components/Turnstile";
import { Spinner, buttonClass } from "~/components/ui";
import { formatEuro } from "~/lib/format";

export interface ReviewSummary {
  registrantName: string;
  membership: string;
  email: string;
  whatsapp: string;
  participants: { name: string; gender: string; ageGroup: string }[];
  marketingOptIn: boolean;
}

const AGE_GROUP: Record<string, string> = { anak: "Anak", remaja: "Remaja", dewasa: "Dewasa" };
const GENDER: Record<string, string> = { "laki-laki": "Laki-laki", perempuan: "Perempuan" };

/**
 * Review step before the registration is sent. The Turnstile check lives here (not on the form): the token is minted
 * right before the real submit, so a long fill-in cannot let it expire, and every reopen gets a fresh widget.
 * The token and the "send" button belong to the form via the `form` attribute (the dialog is portalled outside it).
 */
export function ReviewDialog({
  open,
  onClose,
  formId,
  siteKey,
  summary,
  priceCents,
  payWindowHours,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  formId: string;
  siteKey: string;
  summary: ReviewSummary | null;
  priceCents: number;
  payWindowHours: number;
  submitting: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (open) setToken(null);
  }, [open]);

  const isMember = summary?.membership === "Ya";
  const count = summary?.participants.length ?? 0;

  return (
    <Dialog open={open} onClose={() => (submitting ? undefined : onClose())} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-slate-950/40 backdrop-blur-[2px] transition duration-150 ease-out data-closed:opacity-0"
      />
      <div className="fixed inset-0 flex items-end justify-center p-3 sm:items-center sm:p-4">
        <DialogPanel
          transition
          className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 transition duration-150 ease-out data-closed:translate-y-4 data-closed:opacity-0 sm:data-closed:translate-y-0 sm:data-closed:scale-[0.97]"
        >
          <div className="h-1 shrink-0 bg-brand" aria-hidden="true" />
          <div className="flex shrink-0 gap-4 border-b border-slate-200/80 p-5 sm:p-6">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-white shadow-sm shadow-brand/20">
              <ClipboardDocumentCheckIcon className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 pt-0.5">
              <DialogTitle className="text-lg font-semibold tracking-tight text-slate-900">Periksa data pendaftaran</DialogTitle>
              <Description className="mt-1 text-sm leading-relaxed text-slate-600">
                Pastikan semua data sudah benar sebelum dikirim. Pilih <b>Kembali</b> untuk mengubah data.
              </Description>
            </div>
          </div>

          {summary ? (
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
              <section>
                <h3 className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">Data pendaftar</h3>
                <dl className="mt-2 divide-y divide-slate-200/80 border-y border-slate-200/80 text-sm">
                  <Row label="Nama" value={summary.registrantName} />
                  <Row label="Keanggotaan" value={isMember ? "Anggota PPME Den Haag" : "Bukan anggota"} />
                  <Row label="Email" value={summary.email} emphasis />
                  <Row label="WhatsApp" value={summary.whatsapp} />
                  <Row
                    label="Info kegiatan"
                    value={summary.marketingOptIn ? "Ya, bersedia menerima informasi" : "Tidak"}
                  />
                </dl>
                <p className="mt-2 text-[13px] text-slate-500">Konfirmasi dan QR Code dikirim ke alamat email di atas.</p>
              </section>

              <section>
                <h3 className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
                  Peserta ({count} orang)
                </h3>
                <ol className="mt-2 divide-y divide-slate-200/80 border-y border-slate-200/80">
                  {summary.participants.map((p, i) => (
                    <li key={i} className="flex items-center gap-3 py-2.5 text-sm">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-brand-200 bg-brand-50 font-mono text-xs font-semibold text-brand">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{p.name}</span>
                        <span className="text-slate-500">
                          {GENDER[p.gender] ?? p.gender} · {AGE_GROUP[p.ageGroup] ?? p.ageGroup}
                        </span>
                      </span>
                      {i === 0 ? (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          Pendaftar
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>

              <section className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 text-sm">
                {isMember ? (
                  <p>
                    <span className="font-semibold text-slate-900">Biaya: gratis</span>{" "}
                    <span className="text-slate-600">(anggota PPME Den Haag).</span>
                  </p>
                ) : (
                  <p className="text-slate-600">
                    <span className="font-semibold text-slate-900">
                      Total: {formatEuro(priceCents * count)}
                    </span>{" "}
                    ({count} × {formatEuro(priceCents)}). Instruksi pembayaran dikirim lewat email; bayar dalam{" "}
                    <span className="font-semibold text-slate-900">{payWindowHours} jam</span> setelah mendaftar.
                  </p>
                )}
              </section>

              <section>
                <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
                  <ShieldCheckIcon className="size-4" aria-hidden="true" />
                  Verifikasi keamanan
                </h3>
                <div className="mt-2">
                  <Turnstile siteKey={siteKey} onToken={setToken} />
                </div>
                <input type="hidden" name="cf-turnstile-response" value={token ?? ""} form={formId} />
              </section>
            </div>
          ) : null}

          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200/80 bg-slate-50/80 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className={buttonClass("secondary", "md", "sm:min-h-10")}
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
              Kembali, ubah data
            </button>
            <button
              type="submit"
              form={formId}
              disabled={submitting || !token}
              className={buttonClass("primary", "md", "sm:min-h-10 sm:min-w-56")}
            >
              {submitting ? (
                <>
                  <Spinner />
                  Mengirim pendaftaran…
                </>
              ) : !token ? (
                <>
                  <ShieldCheckIcon className="size-4" aria-hidden="true" />
                  Menunggu verifikasi…
                </>
              ) : (
                <>
                  Ya, kirim pendaftaran
                  <PaperAirplaneIcon className="size-4" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`break-words ${emphasis ? "font-semibold text-slate-900" : "text-slate-800"}`}>{value || "–"}</dd>
    </div>
  );
}
