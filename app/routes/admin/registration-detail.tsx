import { useState } from "react";
import { data, redirect } from "react-router";

import type { Route } from "./+types/registration-detail";
import {
  ArrowUturnLeftIcon,
  BanknotesIcon,
  CheckBadgeIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  IdentificationIcon,
  PaperAirplaneIcon,
  QrCodeIcon,
  QueueListIcon,
  UserIcon,
  UsersIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { ActionButton, DeleteRegistrationButton, DetailList, EmptyState, PageHeader, Panel, PaymentBadge, StatusBadge } from "~/components/admin";
import { buttonClass } from "~/components/ui";
import { handleAdminIntent } from "~/lib/admin-actions.server";
import { adminEmailContext } from "~/lib/admin-context";
import { auditFor, emailLogFor } from "~/lib/admin.server";
import { getParticipants, getRegistration } from "~/lib/db.server";
import { getAppEnv } from "~/lib/env.server";
import { AGE_GROUP_SHORT, GENDER_LABEL, formatDateTime, formatEuro } from "~/lib/format";

export async function loader({ params }: Route.LoaderArgs) {
  const env = getAppEnv();
  const reg = await getRegistration(env.DB, params.id);
  if (!reg) throw data("Pendaftaran tidak ditemukan.", { status: 404 });
  const [participants, emails, audit] = await Promise.all([
    getParticipants(env.DB, reg.id),
    emailLogFor(env.DB, reg.id),
    auditFor(env.DB, reg.id),
  ]);
  const nowIso = new Date().toISOString();
  const effectiveStatus =
    reg.status === "pending_payment" && reg.pay_deadline && reg.pay_deadline <= nowIso ? "expired" : reg.status;
  return { reg, participants, emails, audit, effectiveStatus, canConfirm: reg.status === "pending_payment" && effectiveStatus === "pending_payment" };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const result = await handleAdminIntent(getAppEnv(), context.get(adminEmailContext), form);
  // The page no longer exists after a delete: go back to the list.
  if (result.ok && form.get("intent") === "delete-registration") return redirect("/admin/registrations");
  return result;
}

const EMAIL_LABEL: Record<string, string> = {
  confirmation: "Konfirmasi + QR",
  payment_instructions: "Instruksi pembayaran",
  reminder: "Pengingat",
  expired: "Kedaluwarsa",
  membership_pending: "Menunggu validasi anggota",
};

export default function RegistrationDetail({ loaderData }: Route.ComponentProps) {
  const { reg, participants, emails, audit, effectiveStatus, canConfirm } = loaderData;
  const [showTickets, setShowTickets] = useState(false);

  return (
    <div>
      <PageHeader
        back={{ to: "/admin/registrations", label: "Kembali ke daftar" }}
        eyebrow="Detail pendaftaran"
        title={reg.registrant_name}
        actions={<DeleteRegistrationButton registrationId={reg.id} name={reg.registrant_name} />}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <StatusBadge status={effectiveStatus} />
            <span>
              {reg.is_member ? "Anggota" : "Non-anggota"} · {reg.source === "manual" ? "manual" : "online"} ·{" "}
              {participants.length} peserta
            </span>
          </span>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Pendaftar" icon={UserIcon}>
            <DetailList
              items={[
                ["Email", <span className="break-all">{reg.email ?? "–"}</span>],
                ["WhatsApp", reg.whatsapp ?? "–"],
                [
                  "Kategori",
                  `${reg.is_member ? "Anggota PPME Den Haag" : "Non-anggota"} · ${reg.source === "manual" ? "manual" : "online"}`,
                ],
                ["Didaftarkan", <span className="tabular-nums">{formatDateTime(reg.created_at)}</span>],
                [
                  "Persetujuan privasi",
                  <>
                    {reg.consent_at ? `${formatDateTime(reg.consent_at)} (${reg.privacy_version})` : "–"}
                    {reg.marketing_opt_in ? " · bersedia menerima info" : ""}
                  </>,
                ],
                [
                  "Dokumentasi & live stream",
                  reg.media_consent_at ? `${formatDateTime(reg.media_consent_at)} (${reg.media_notice_version})` : "–",
                ],
              ]}
            />
            {reg.is_member ? (
              <div className="mt-5 border-t border-slate-100 pt-4 text-sm">
                {reg.status === "rejected_membership" ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-start gap-2 text-red-700">
                      <XCircleIcon className="mt-px size-5 shrink-0" aria-hidden="true" />
                      <span>Pendaftaran ditolak: keanggotaan tidak valid.</span>
                    </span>
                    <ActionButton
                      intent="verify-membership"
                      registrationId={reg.id}
                      label="Validasi anggota (aktifkan kembali)"
                      icon={CheckBadgeIcon}
                      confirm={{
                        title: "Aktifkan kembali pendaftaran",
                        description: (
                          <>
                            Keanggotaan <strong>{reg.registrant_name}</strong> ternyata valid? Pendaftaran akan diaktifkan
                            kembali dan QR Code baru dikirim ke pendaftar.
                          </>
                        ),
                        confirmLabel: "Ya, aktifkan kembali",
                        tone: "info",
                        icon: CheckBadgeIcon,
                      }}
                    />
                  </div>
                ) : reg.status === "pending_membership" ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-amber-700">
                      <ExclamationTriangleIcon className="size-5 shrink-0" aria-hidden="true" />
                      Menunggu validasi keanggotaan. QR Code belum dikirim.
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <ActionButton
                        intent="verify-membership"
                        registrationId={reg.id}
                        label="Validasi anggota"
                        icon={CheckBadgeIcon}
                        confirm={{
                          title: "Validasi keanggotaan",
                          description: (
                            <>
                              Apakah <strong>{reg.registrant_name}</strong> sudah dicek dan benar terdaftar di daftar anggota
                              PPME Den Haag? Pendaftaran akan diterima dan QR Code langsung dikirim ke pendaftar.
                            </>
                          ),
                          confirmLabel: "Ya, anggota valid",
                          tone: "info",
                          icon: CheckBadgeIcon,
                        }}
                      />
                      <ActionButton
                        intent="reject-membership"
                        registrationId={reg.id}
                        label="Tolak (bukan anggota)"
                        tone="danger"
                        icon={XCircleIcon}
                        confirm={{
                          title: "Tolak pendaftaran",
                          description: (
                            <>
                              Keanggotaan <strong>{reg.registrant_name}</strong> tidak dapat divalidasi? Pendaftaran akan
                              ditolak dan kursi dibebaskan. Tidak ada email otomatis yang dikirim.
                            </>
                          ),
                          confirmLabel: "Ya, tolak",
                          tone: "danger",
                          icon: XCircleIcon,
                        }}
                      />
                    </span>
                  </div>
                ) : reg.membership_verified_at ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-start gap-2 text-emerald-700">
                      <CheckBadgeIcon className="mt-px size-5 shrink-0" aria-hidden="true" />
                      <span>
                        Keanggotaan diverifikasi oleh {reg.membership_verified_by} (
                        {formatDateTime(reg.membership_verified_at)})
                      </span>
                    </span>
                    <ActionButton
                      intent="unverify-membership"
                      registrationId={reg.id}
                      label="Batalkan"
                      tone="neutral"
                      icon={ArrowUturnLeftIcon}
                    />
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-amber-700">
                      <ExclamationTriangleIcon className="size-5 shrink-0" aria-hidden="true" />
                      Keanggotaan belum diverifikasi.
                    </span>
                    <ActionButton
                      intent="verify-membership"
                      registrationId={reg.id}
                      label="Tandai terverifikasi"
                      icon={CheckBadgeIcon}
                      confirm={{
                        title: "Verifikasi keanggotaan",
                        description: "Keanggotaan pendaftar ini sudah dicek di daftar anggota PPME Den Haag?",
                        confirmLabel: "Ya, sudah dicek",
                        tone: "info",
                        icon: CheckBadgeIcon,
                      }}
                    />
                  </div>
                )}
              </div>
            ) : null}
          </Panel>

          <Panel title="Pembayaran" icon={BanknotesIcon}>
            {reg.is_member && reg.payment_status === "free" ? (
              <p className="flex items-center gap-2 text-sm text-slate-600">
                <IdentificationIcon className="size-5 text-slate-400" aria-hidden="true" />
                Gratis (anggota).
              </p>
            ) : (
              <DetailList
                items={[
                  ["Status", <PaymentBadge status={reg.payment_status} />],
                  ["Kode", <span className="font-mono font-semibold text-brand">{reg.payment_code ?? "–"}</span>],
                  ["Jumlah", <span className="tabular-nums">{formatEuro(reg.amount_cents)}</span>],
                  ["Batas bayar", <span className="tabular-nums">{formatDateTime(reg.pay_deadline) || "–"}</span>],
                  ["Dikonfirmasi", reg.paid_at ? `${formatDateTime(reg.paid_at)} oleh ${reg.confirmed_by}` : "–"],
                ]}
              />
            )}
            {canConfirm ? (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="mb-3 text-sm text-slate-600">
                  Cek mutasi rekening: transfer <span className="font-semibold text-slate-900">{formatEuro(reg.amount_cents)}</span>{" "}
                  dengan keterangan <span className="font-mono font-semibold text-slate-900">{reg.payment_code}</span>.
                </p>
                <ActionButton
                  intent="confirm-payment"
                  registrationId={reg.id}
                  label="Konfirmasi pembayaran & setujui"
                  tone="success"
                  icon={CheckIcon}
                  confirm={{
                    title: "Konfirmasi pembayaran",
                    description: `Pembayaran ${reg.payment_code} sebesar ${formatEuro(reg.amount_cents)} sudah benar-benar diterima di rekening PPME? QR Code akan langsung dikirim ke pendaftar.`,
                    confirmLabel: "Ya, konfirmasi",
                    tone: "info",
                    icon: BanknotesIcon,
                  }}
                />
              </div>
            ) : null}
            {effectiveStatus === "expired" && reg.payment_status !== "paid" ? (
              <p className="mt-5 flex items-start gap-2 border-t border-slate-100 pt-4 text-sm text-slate-600">
                <ClockIcon className="mt-px size-5 shrink-0 text-slate-400" aria-hidden="true" />
                Batas pembayaran sudah lewat; pendaftaran tidak dapat diaktifkan. Pembayaran terlambat diselesaikan
                manual oleh bendahara.
              </p>
            ) : null}
          </Panel>
        </div>

        <Panel
          title={`Peserta (${participants.length})`}
          icon={UsersIcon}
          flush
          actions={
            <button type="button" onClick={() => setShowTickets((v) => !v)} className={buttonClass("ghost", "sm")}>
              {showTickets ? (
                <EyeSlashIcon className="size-4" aria-hidden="true" />
              ) : (
                <EyeIcon className="size-4" aria-hidden="true" />
              )}
              {showTickets ? "Sembunyikan kode" : "Tampilkan kode"}
            </button>
          }
        >
          <p className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
            Kode tiket = isi QR. Kode acak tanpa data pribadi; hanya panitia yang bisa menghubungkannya ke peserta.
          </p>
          <ul className="divide-y divide-slate-100">
            {participants.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-3 text-sm sm:px-5">
                <span className="flex size-6 items-center justify-center rounded-md border border-slate-200 font-mono text-xs text-slate-500">
                  {p.position}
                </span>
                <span className="min-w-[160px] flex-1 font-medium text-slate-900">{p.full_name}</span>
                <span className="text-slate-600 tabular-nums">
                  {AGE_GROUP_SHORT[p.age_group] ?? p.age_group} · {p.gender ? GENDER_LABEL[p.gender] : "–"}
                </span>
                <span className="font-mono text-xs text-slate-500">
                  {p.qr_token ? (showTickets ? p.qr_token : `${p.qr_token.slice(0, 4)}••••`) : "belum ada tiket"}
                </span>
                <span className="text-xs">
                  {p.checked_in_at ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircleIcon className="size-4" aria-hidden="true" />
                      check-in {formatDateTime(p.checked_in_at)}
                    </span>
                  ) : (
                    <span className="text-slate-400">belum check-in</span>
                  )}
                </span>
                {p.qr_token && p.status === "accepted" ? (
                  p.checked_in_at ? (
                    <ActionButton
                      intent="admin-undo-checkin"
                      label="Batalkan check-in"
                      tone="neutral"
                      icon={ArrowUturnLeftIcon}
                      extra={{ participantId: p.id }}
                      confirm={{
                        title: "Batalkan check-in",
                        description: `${p.full_name} ditandai belum masuk lagi. Tindakan dicatat di log.`,
                        confirmLabel: "Ya, batalkan",
                        tone: "danger",
                        icon: ArrowUturnLeftIcon,
                      }}
                    />
                  ) : (
                    <ActionButton
                      intent="admin-checkin"
                      label="Check-in manual"
                      tone="neutral"
                      icon={QrCodeIcon}
                      extra={{ participantId: p.id }}
                      confirm={{
                        title: "Check-in manual",
                        description: `${p.full_name} ditandai sudah masuk (misalnya QR hilang). Tindakan dicatat di log.`,
                        confirmLabel: "Ya, check-in",
                        tone: "info",
                        icon: QrCodeIcon,
                      }}
                    />
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Email" icon={EnvelopeIcon}>
            {emails.length === 0 ? <p className="text-sm text-slate-500">Belum ada email.</p> : null}
            <ul className="space-y-3 text-sm">
              {emails.map((e) => {
                const Icon = e.status === "sent" ? CheckCircleIcon : e.status === "pending" ? ClockIcon : XCircleIcon;
                const tone =
                  e.status === "sent" ? "text-emerald-700" : e.status === "pending" ? "text-amber-700" : "text-red-600";
                return (
                  <li key={e.kind} className="flex items-start gap-2.5">
                    <Icon className={`mt-px size-5 shrink-0 ${tone}`} aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{EMAIL_LABEL[e.kind] ?? e.kind}</div>
                      <div className={`text-xs ${tone}`}>
                        {e.status === "sent"
                          ? `terkirim ${formatDateTime(e.sent_at)}`
                          : e.status === "pending"
                            ? `menunggu pengiriman (percobaan ${e.attempts})`
                            : `gagal (${e.attempts}x): ${e.last_error}`}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {(reg.status === "accepted" || reg.status === "pending_payment" || reg.status === "pending_membership") && reg.email ? (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                {reg.status === "pending_membership" ? (
                  <ActionButton
                    intent="resend-email"
                    registrationId={reg.id}
                    extra={{ kind: "membership_pending" }}
                    label="Kirim ulang pemberitahuan"
                    tone="neutral"
                    icon={PaperAirplaneIcon}
                  />
                ) : reg.status === "accepted" ? (
                  <ActionButton
                    intent="resend-email"
                    registrationId={reg.id}
                    extra={{ kind: "confirmation" }}
                    label="Kirim ulang QR"
                    tone="neutral"
                    icon={PaperAirplaneIcon}
                    confirm={{
                      title: "Kirim ulang QR",
                      description: "Email konfirmasi beserta QR Code akan dikirim ulang ke pendaftar.",
                      confirmLabel: "Kirim ulang",
                      tone: "info",
                      icon: EnvelopeIcon,
                    }}
                  />
                ) : (
                  <ActionButton
                    intent="resend-email"
                    registrationId={reg.id}
                    extra={{ kind: "payment_instructions" }}
                    label="Kirim ulang instruksi bayar"
                    tone="neutral"
                    icon={PaperAirplaneIcon}
                  />
                )}
              </div>
            ) : null}
          </Panel>

          <Panel title="Riwayat aksi" icon={QueueListIcon}>
            {audit.length === 0 ? (
              <EmptyState>Belum ada aksi.</EmptyState>
            ) : (
              <ol className="relative space-y-4 border-l border-slate-200 pl-5">
                {audit.map((a, i) => (
                  <li key={i} className="relative text-xs">
                    <span
                      className="absolute top-1 -left-[23.5px] size-2 rounded-full border-2 border-white bg-brand ring-1 ring-brand-200"
                      aria-hidden="true"
                    />
                    <div className="font-medium text-slate-900">{a.action}</div>
                    <div className="mt-0.5 text-slate-500">
                      <span className="tabular-nums">{formatDateTime(a.at)}</span> · {a.actor}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
