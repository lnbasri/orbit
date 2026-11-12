import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CakeIcon,
  EnvelopeIcon,
  ExclamationCircleIcon,
  PaperAirplaneIcon,
  PhoneIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { Form } from "react-router";

import { Turnstile } from "~/components/Turnstile";
import { Callout, Spinner, buttonClass } from "~/components/ui";
import { formatEuro } from "~/lib/format";
import type { FieldErrors } from "~/lib/validation";
import { CheckField, ChoiceField, CountCombobox, TextInputField } from "./controls";
import type { PublicEvent } from "./HeaderSection";

interface ParticipantDraft {
  name: string;
  gender: string;
  birthYear: string;
}

const emptyParticipant = (): ParticipantDraft => ({ name: "", gender: "", birthYear: "" });

export interface FormFailure {
  ok: false;
  errors: FieldErrors;
  message: string;
}

export function RegistrationForm({
  event,
  siteKey,
  quotaFull,
  failure,
  submitting,
}: {
  event: PublicEvent;
  siteKey: string;
  quotaFull: { member: boolean; nonMember: boolean };
  failure?: FormFailure;
  submitting: boolean;
}) {
  const [registrantName, setRegistrantName] = useState("");
  const [membership, setMembership] = useState("");
  const [consent, setConsent] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [count, setCount] = useState(1);
  const [participants, setParticipants] = useState<ParticipantDraft[]>([emptyParticipant()]);
  const [firstNameTouched, setFirstNameTouched] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  // A fresh key per filled-in form: a double submit returns the same registration.
  useEffect(() => setIdempotencyKey(crypto.randomUUID()), []);

  useEffect(() => {
    setParticipants((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push(emptyParticipant());
      return next;
    });
  }, [count]);

  useEffect(() => {
    if (!firstNameTouched) {
      setParticipants((prev) => prev.map((p, i) => (i === 0 ? { ...p, name: registrantName } : p)));
    }
  }, [registrantName, firstNameTouched]);

  // Radio groups, the combobox and the checkbox have no native "required" validation: check them after the first submit try.
  const errors: FieldErrors = { ...(failure?.errors ?? {}) };
  if (submitted && !membership) errors.membership = "Pilih status keanggotaan.";
  if (submitted && !consent) errors.consent = "Persetujuan privasi wajib dicentang.";
  participants.forEach((p, i) => {
    if (submitted && !p.gender) errors[`participants.${i}.gender`] = "Jenis kelamin wajib dipilih.";
  });
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const update = (i: number, patch: Partial<ParticipantDraft>) =>
    setParticipants((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  return (
    <Form
      method="post"
      onSubmit={(e) => {
        setSubmitted(true);
        if (!membership || !consent || participants.some((p) => !p.gender)) e.preventDefault();
      }}
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="participantCount" value={count} />

      <div className="divide-y divide-slate-200/80 border-t border-slate-200/80">
        <FormSection step="A" title="Data pendaftar" description="Orang yang mengisi formulir dan menerima email konfirmasi.">
          <div className="grid gap-5 md:grid-cols-2">
            <TextInputField
              label="Nama lengkap pendaftar"
              icon={UserIcon}
              name="registrantName"
              maxLength={120}
              autoComplete="name"
              value={registrantName}
              onChange={(e) => setRegistrantName(e.target.value)}
              placeholder="Masukkan nama lengkap"
              error={errors.registrantName}
            />
            <ChoiceField
              label="Apakah Anda anggota PPME Den Haag?"
              name="membership"
              value={membership}
              onChange={setMembership}
              error={errors.membership}
              options={[
                {
                  value: "Ya",
                  label: "Ya, anggota",
                  hint: quotaFull.member ? "Kuota penuh" : "Gratis",
                  disabled: quotaFull.member,
                },
                {
                  value: "Tidak",
                  label: "Bukan anggota",
                  hint: quotaFull.nonMember ? "Kuota penuh" : `${formatEuro(event.priceCents)} per orang`,
                  disabled: quotaFull.nonMember,
                },
              ]}
            />
            <TextInputField
              label="Alamat email aktif"
              icon={EnvelopeIcon}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="nama@email.com"
              hint="Konfirmasi dan QR Code dikirim ke alamat ini."
              error={errors.email}
            />
            <TextInputField
              label="Nomor WhatsApp"
              icon={PhoneIcon}
              name="whatsapp"
              type="tel"
              autoComplete="tel"
              placeholder="+31 6 ..."
              hint="Hanya untuk menghubungi Anda terkait acara ini."
              error={errors.whatsapp}
            />
          </div>
        </FormSection>

        <FormSection
          step="B"
          title="Jumlah peserta"
          description={`Perorangan atau keluarga, maksimal ${event.maxFamily} orang termasuk Anda.`}
        >
          <div className="md:max-w-sm">
            <CountCombobox
              label="Berapa jumlah seluruh peserta (termasuk Anda)?"
              value={count}
              max={event.maxFamily}
              onChange={setCount}
              error={errors.participants}
            />
          </div>
        </FormSection>

        <FormSection
          step="C"
          title="Data seluruh peserta"
          description="Tahun lahir dan jenis kelamin diperlukan untuk pengaturan tempat dan kategori usia."
        >
          <div className="divide-y divide-slate-200/80">
            {participants.map((p, i) => (
              <fieldset key={i} className="min-w-0 py-6 first:pt-0 last:pb-0">
                <legend className="float-left mb-4 flex w-full items-center gap-3">
                  <span className="flex size-7 items-center justify-center rounded-md border border-brand-200 bg-brand-50 font-mono text-xs font-semibold text-brand">
                    {i + 1}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">Peserta {i + 1}</span>
                  {i === 0 ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Pendaftar</span>
                  ) : null}
                </legend>
                <div className="clear-left grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
                  <TextInputField
                    label="Nama lengkap"
                    icon={UserIcon}
                    name={`p${i}_name`}
                    maxLength={120}
                    value={p.name}
                    onChange={(e) => {
                      if (i === 0) setFirstNameTouched(true);
                      update(i, { name: e.target.value });
                    }}
                    error={errors[`participants.${i}.name`]}
                    className="sm:col-span-2"
                  />
                  <ChoiceField
                    label="Jenis kelamin"
                    name={`p${i}_gender`}
                    value={p.gender}
                    onChange={(v) => update(i, { gender: v })}
                    error={errors[`participants.${i}.gender`]}
                    options={[
                      { value: "male", label: "Laki-laki" },
                      { value: "female", label: "Perempuan" },
                    ]}
                  />
                  <TextInputField
                    label="Tahun lahir"
                    icon={CakeIcon}
                    name={`p${i}_birthYear`}
                    type="number"
                    inputMode="numeric"
                    min={1900}
                    max={currentYear}
                    value={p.birthYear}
                    onChange={(e) => update(i, { birthYear: e.target.value })}
                    placeholder="Contoh: 2015"
                    error={errors[`participants.${i}.birthYear`]}
                  />
                </div>
              </fieldset>
            ))}
          </div>
        </FormSection>

        <FormSection step="D" title="Privasi" description="Bagaimana data Anda digunakan dan disimpan.">
          <p className="text-sm leading-relaxed text-slate-600">
            PPME Den Haag memproses data di formulir ini hanya untuk pendaftaran, pembayaran, tiket, dan check-in acara
            ini. Data disimpan di layanan Cloudflare (Uni Eropa) dan email dikirim melalui Resend. Data peserta dihapus
            atau dianonimkan paling lambat 90 hari setelah acara; catatan pembayaran disimpan sesuai kewajiban
            pembukuan. Anda dapat meminta akses, koreksi, atau penghapusan data melalui email panitia.
          </p>
          <div className="mt-5 space-y-4 border-t border-slate-200/80 pt-5">
            <div>
              <CheckField name="consent" checked={consent} onChange={setConsent} invalid={!!errors.consent} required>
                Saya menyetujui pemrosesan data saya dan seluruh peserta yang saya daftarkan untuk keperluan kajian
                keagamaan ini, dan saya berwenang mendaftarkan mereka.
              </CheckField>
              {errors.consent ? (
                <p className="mt-1.5 flex items-center gap-1.5 pl-8 text-[13px] font-medium text-red-600">
                  <ExclamationCircleIcon className="size-4 shrink-0" aria-hidden="true" />
                  {errors.consent}
                </p>
              ) : null}
            </div>
            <CheckField name="marketingOptIn" checked={marketingOptIn} onChange={setMarketingOptIn}>
              <span className="text-slate-500">(Opsional)</span> Saya bersedia menerima informasi kegiatan PPME Den
              Haag berikutnya.
            </CheckField>
          </div>
        </FormSection>
      </div>

      <div className="border-t border-slate-200/80 bg-slate-50/70 px-5 py-6 sm:px-8 lg:px-10">
        {failure ? (
          <Callout tone="danger" role="alert" icon={ExclamationCircleIcon} className="mb-5">
            <p>{failure.message}</p>
          </Callout>
        ) : null}
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <Turnstile siteKey={siteKey} resetKey={failure} onToken={setToken} />
          </div>
          <button
            type="submit"
            disabled={submitting || !token}
            className={buttonClass("primary", "lg", "w-full md:w-auto md:min-w-72")}
          >
            {submitting ? (
              <>
                <Spinner />
                Mengirim pendaftaran…
              </>
            ) : !token ? (
              <>
                <ShieldCheckIcon className="size-5" aria-hidden="true" />
                Menunggu verifikasi…
              </>
            ) : (
              <>
                Kirim pendaftaran
                <PaperAirplaneIcon className="size-5" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </Form>
  );
}

/** Two-column form section: step, heading and description on the left, fields on the right. */
function FormSection({
  step,
  title,
  description,
  children,
}: {
  step: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-x-10 gap-y-5 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:px-10 lg:py-10">
      <div>
        <div className="flex items-center gap-3 lg:block">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-brand uppercase">Bagian {step}</span>
          <h2 className="text-base font-semibold text-slate-900 lg:mt-1.5">{title}</h2>
        </div>
        {description ? <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
