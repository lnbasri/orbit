import { useState, type ReactNode } from "react";
import {
  BanknotesIcon,
  BuildingLibraryIcon,
  CheckCircleIcon,
  ClockIcon,
  EnvelopeIcon,
  ExclamationCircleIcon,
  HashtagIcon,
  LockClosedIcon,
  PencilSquareIcon,
  PhoneIcon,
  PlusIcon,
  QrCodeIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { Form, useNavigation } from "react-router";

import { Callout, Eyebrow, Spinner, buttonClass } from "~/components/ui";
import { AGE_GROUP_SHORT, GENDER_LABEL, formatDateTime, formatEuro } from "~/lib/format";
import type { FieldErrors } from "~/lib/validation";
import { ChoiceField, TextInputField } from "./controls";
import { EventDetailRow } from "./EventDetailRow";

export interface MyRegistration {
  registrantName: string;
  whatsapp: string;
  email: string;
  isMember: boolean;
  status: "accepted" | "pending_payment";
  paymentStatus: string;
  paymentCode: string | null;
  amountCents: number;
  payDeadline: string | null;
  paidAt: string | null;
  createdAt: string;
  editRev: string;
}

export interface MyParticipant {
  id: string;
  name: string;
  gender: string;
  ageGroup: string;
  hasTicket: boolean;
}

export type MyEditState = { editable: true; until: string | null } | { editable: false; message: string; paid: boolean };

export type SaveResult = { ok: true; message: string } | { ok: false; message: string; errors: FieldErrors };

interface Draft {
  key: string;
  id?: string;
  name: string;
  gender: string;
  ageGroup: string;
}

const statusLine = (r: MyRegistration) =>
  r.status === "pending_payment"
    ? { label: "Menunggu pembayaran", tone: "text-amber-700", icon: ClockIcon }
    : { label: r.isMember ? "Diterima – anggota" : "Diterima – lunas", tone: "text-emerald-700", icon: CheckCircleIcon };

export function ManageRegistration({
  registration: r,
  participants,
  state,
  priceCents,
  maxFamily,
  contact,
  bank,
  result,
}: {
  registration: MyRegistration;
  participants: MyParticipant[];
  state: MyEditState;
  priceCents: number;
  maxFamily: number;
  contact: string;
  bank: { accountName: string; iban: string } | null;
  result?: SaveResult;
}) {
  const status = statusLine(r);
  const pending = r.status === "pending_payment";

  return (
    <>
      <dl className="grid gap-px border-y border-slate-200/80 bg-slate-200/80 sm:grid-cols-2 lg:grid-cols-4">
        <EventDetailRow
          icon={status.icon}
          label="Status"
          value={<span className={status.tone}>{status.label}</span>}
          sub={`Didaftarkan ${formatDateTime(r.createdAt)}`}
        />
        <EventDetailRow icon={UsersIcon} label="Jumlah peserta" value={`${participants.length} orang`} sub={r.isMember ? "Gratis untuk anggota" : formatEuro(r.amountCents)} />
        <EventDetailRow icon={EnvelopeIcon} label="Email" value={<span className="break-all">{r.email}</span>} sub="Tidak dapat diubah sendiri" />
        <EventDetailRow icon={PhoneIcon} label="WhatsApp" value={r.whatsapp || "–"} />
      </dl>

      {pending && r.paymentCode && bank ? (
        <div className="border-b border-slate-200/80 bg-brand-50/50 px-5 py-6 sm:px-8 lg:px-10">
          <Eyebrow>Pembayaran</Eyebrow>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{formatEuro(r.amountCents)}</p>
          <p className="mt-1 text-sm text-slate-600">
            Sebelum <span className="font-semibold text-slate-900">{formatDateTime(r.payDeadline)} waktu Belanda</span> · QR
            Code dikirim setelah panitia mengonfirmasi pembayaran.
          </p>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            <PayItem icon={HashtagIcon} label="Kode pembayaran (keterangan transfer)">
              <span className="font-mono text-base tracking-wide text-brand">{r.paymentCode}</span>
            </PayItem>
            <PayItem icon={BuildingLibraryIcon} label="Nama rekening">
              {bank.accountName}
            </PayItem>
            <PayItem icon={BanknotesIcon} label="IBAN">
              <span className="font-mono break-all">{bank.iban}</span>
            </PayItem>
          </dl>
        </div>
      ) : null}

      <div className="px-5 py-8 sm:px-8 lg:px-10">
        {result ? (
          <Callout
            tone={result.ok ? "success" : "danger"}
            icon={result.ok ? CheckCircleIcon : ExclamationCircleIcon}
            role={result.ok ? "status" : "alert"}
            className="mb-6"
          >
            <p>{result.message}</p>
          </Callout>
        ) : null}

        {state.editable ? (
          <EditForm
            key={r.editRev || "initial"}
            registration={r}
            participants={participants}
            until={state.until}
            priceCents={priceCents}
            maxFamily={maxFamily}
            contact={contact}
            errors={result && !result.ok ? result.errors : {}}
          />
        ) : (
          <ReadOnly registration={r} participants={participants} state={state} contact={contact} />
        )}
      </div>
    </>
  );
}

function PayItem({ icon: Icon, label, children }: { icon: typeof HashtagIcon; label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
        <Icon className="size-4 text-brand" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

function ReadOnly({
  registration: r,
  participants,
  state,
  contact,
}: {
  registration: MyRegistration;
  participants: MyParticipant[];
  state: Extract<MyEditState, { editable: false }>;
  contact: string;
}) {
  return (
    <div className="space-y-8">
      <Callout tone={state.paid ? "warning" : "neutral"} icon={LockClosedIcon} title="Perubahan melalui panitia">
        <p>{state.message}</p>
        <p>
          Jika ada data yang perlu diubah, kirim email ke{" "}
          <a className="font-semibold text-brand underline hover:text-brand-dark" href={`mailto:${contact}`}>
            {contact}
          </a>{" "}
          dengan menyebutkan nama pendaftar{r.paymentCode ? ` dan kode pembayaran ${r.paymentCode}` : ""}.
        </p>
      </Callout>

      <section>
        <h2 className="text-base font-semibold text-slate-900">Data pendaftar</h2>
        <dl className="mt-3 divide-y divide-slate-200/80 border-y border-slate-200/80 text-sm">
          <Row label="Nama pendaftar">{r.registrantName}</Row>
          <Row label="Keanggotaan">{r.isMember ? "Anggota PPME Den Haag" : "Bukan anggota"}</Row>
          {r.paidAt ? <Row label="Pembayaran dikonfirmasi">{formatDateTime(r.paidAt)}</Row> : null}
        </dl>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-900">Peserta</h2>
        <ol className="mt-3 divide-y divide-slate-200/80 border-y border-slate-200/80">
          {participants.map((p, i) => (
            <li key={p.id} className="flex items-center gap-3 py-3 text-sm">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-brand-200 bg-brand-50 font-mono text-xs font-semibold text-brand">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">{p.name}</span>
                <span className="text-slate-500">
                  {GENDER_LABEL[p.gender] ?? "–"} · {AGE_GROUP_SHORT[p.ageGroup] ?? p.ageGroup}
                </span>
              </span>
              {p.hasTicket ? (
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <QrCodeIcon className="size-4" aria-hidden="true" />
                  QR dikirim
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

let draftSeq = 0;
const newKey = () => `n${++draftSeq}`;

function EditForm({
  registration: r,
  participants: initial,
  until,
  priceCents,
  maxFamily,
  contact,
  errors: serverErrors,
}: {
  registration: MyRegistration;
  participants: MyParticipant[];
  until: string | null;
  priceCents: number;
  maxFamily: number;
  contact: string;
  errors: FieldErrors;
}) {
  const navigation = useNavigation();
  const saving = navigation.state !== "idle" && navigation.formData?.get("intent") === "save";
  const [submitted, setSubmitted] = useState(false);
  const [rows, setRows] = useState<Draft[]>(() =>
    initial.map((p) => ({ key: p.id, id: p.id, name: p.name, gender: p.gender, ageGroup: p.ageGroup })),
  );
  const pending = r.status === "pending_payment";
  const newAmount = rows.length * priceCents;

  const errors: FieldErrors = { ...serverErrors };
  rows.forEach((p, i) => {
    if (submitted && !p.gender) errors[`participants.${i}.gender`] = "Jenis kelamin wajib dipilih.";
  });

  const update = (i: number, patch: Partial<Draft>) =>
    setRows((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const removedWithTicket = initial.filter((p) => p.hasTicket && !rows.some((row) => row.id === p.id)).length;

  return (
    <Form
      method="post"
      onSubmit={(e) => {
        setSubmitted(true);
        if (rows.some((p) => !p.gender)) e.preventDefault();
      }}
      className="space-y-8"
    >
      <input type="hidden" name="intent" value="save" />
      <input type="hidden" name="rev" value={r.editRev} />
      <input type="hidden" name="participantCount" value={rows.length} />

      <Callout tone="info" icon={PencilSquareIcon} title="Anda dapat mengubah pendaftaran ini">
        <p>
          {pending
            ? "Perubahan dapat dilakukan selama pembayaran belum dikonfirmasi panitia"
            : "Perubahan dapat dilakukan selama pendaftaran masih dibuka"}
          {until ? (
            <>
              , paling lambat <span className="font-semibold">{formatDateTime(until)} waktu Belanda</span>
            </>
          ) : null}
          . Setelah disimpan, email dengan data terbaru dikirim ke {r.email}.
        </p>
        <p className="text-slate-500">
          Alamat email dan status keanggotaan hanya dapat diubah melalui panitia ({" "}
          <a className="font-medium text-brand underline" href={`mailto:${contact}`}>
            {contact}
          </a>
          ).
        </p>
      </Callout>

      <section className="space-y-5">
        <h2 className="text-base font-semibold text-slate-900">Data pendaftar</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <TextInputField
            label="Nama lengkap pendaftar"
            icon={UserIcon}
            name="registrantName"
            maxLength={120}
            autoComplete="name"
            defaultValue={r.registrantName}
            error={errors.registrantName}
          />
          <TextInputField
            label="Nomor WhatsApp"
            icon={PhoneIcon}
            name="whatsapp"
            type="tel"
            autoComplete="tel"
            defaultValue={r.whatsapp}
            error={errors.whatsapp}
          />
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Peserta ({rows.length} orang)</h2>
            <p className="mt-1 text-sm text-slate-500">Maksimal {maxFamily} orang termasuk Anda.</p>
          </div>
          <button
            type="button"
            disabled={rows.length >= maxFamily}
            onClick={() => setRows((prev) => [...prev, { key: newKey(), name: "", gender: "", ageGroup: "" }])}
            className={buttonClass("secondary", "sm")}
          >
            <PlusIcon className="size-4" aria-hidden="true" />
            Tambah peserta
          </button>
        </div>
        {errors.participants ? (
          <p className="mt-2 text-[13px] font-medium text-red-600">{errors.participants}</p>
        ) : null}

        <div className="mt-4 divide-y divide-slate-200/80 border-y border-slate-200/80">
          {rows.map((p, i) => (
            <fieldset key={p.key} className="min-w-0 py-6">
              <legend className="float-left mb-4 flex w-full items-center gap-3">
                <span className="flex size-7 items-center justify-center rounded-md border border-brand-200 bg-brand-50 font-mono text-xs font-semibold text-brand">
                  {i + 1}
                </span>
                <span className="text-sm font-semibold text-slate-900">Peserta {i + 1}</span>
                {!p.id ? (
                  <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand">Baru</span>
                ) : null}
                <button
                  type="button"
                  disabled={rows.length <= 1}
                  onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                  className={buttonClass("ghost", "sm", "ml-auto text-red-600 hover:bg-red-50 hover:text-red-700")}
                  aria-label={`Hapus peserta ${i + 1}`}
                >
                  <TrashIcon className="size-4" aria-hidden="true" />
                  Hapus
                </button>
              </legend>
              <input type="hidden" name={`p${i}_id`} value={p.id ?? ""} />
              <div className="clear-left grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
                <TextInputField
                  label="Nama lengkap"
                  icon={UserIcon}
                  name={`p${i}_name`}
                  maxLength={120}
                  value={p.name}
                  onChange={(e) => update(i, { name: e.target.value })}
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
                    { value: "laki-laki", label: "Laki-laki" },
                    { value: "perempuan", label: "Perempuan" },
                  ]}
                  className="sm:col-span-2"
                />
                <ChoiceField
                  label="Kelompok usia"
                  name={`p${i}_ageGroup`}
                  value={p.ageGroup}
                  onChange={(v) => update(i, { ageGroup: v })}
                  error={errors[`participants.${i}.ageGroup`]}
                  options={[
                      { value: "anak", label: "Anak", hint: "0 – di bawah 12 tahun" },
                      { value: "remaja", label: "Remaja", hint: "12 – di bawah 18 tahun" },
                      { value: "dewasa", label: "Dewasa", hint: "18 tahun ke atas" },
                    ]}
                  className="sm:col-span-2"
                />
              </div>
            </fieldset>
          ))}
        </div>

        {pending && newAmount !== r.amountCents ? (
          <Callout tone="warning" icon={BanknotesIcon} className="mt-5">
            <p>
              Total pembayaran berubah dari {formatEuro(r.amountCents)} menjadi{" "}
              <span className="font-semibold">{formatEuro(newAmount)}</span> ({rows.length} orang). Kode pembayaran dan batas
              pembayaran tetap sama.
            </p>
            <p>Jika Anda sudah mentransfer jumlah lama, hubungi panitia sebelum mengubah jumlah peserta.</p>
          </Callout>
        ) : null}
        {removedWithTicket > 0 ? (
          <Callout tone="warning" icon={QrCodeIcon} className="mt-5">
            <p>QR Code peserta yang dihapus tidak berlaku lagi. Peserta baru menerima QR Code melalui email setelah disimpan.</p>
          </Callout>
        ) : null}
      </section>

      <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-6 sm:flex-row sm:items-center sm:justify-end">
        <button type="submit" disabled={saving} className={buttonClass("primary", "lg", "w-full sm:w-auto sm:min-w-64")}>
          {saving ? <Spinner /> : <CheckCircleIcon className="size-5" aria-hidden="true" />}
          {saving ? "Menyimpan…" : "Simpan perubahan"}
        </button>
      </div>
    </Form>
  );
}
