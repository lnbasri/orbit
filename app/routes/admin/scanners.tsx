import {
  ArrowRightOnRectangleIcon,
  BuildingOffice2Icon,
  CheckCircleIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  LifebuoyIcon,
  LinkIcon,
  PhoneIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserGroupIcon,
  UserMinusIcon,
  UserPlusIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";

import type { Route } from "./+types/scanners";
import { ActionButton, EmptyState, Notice, PageHeader, Panel, Stat, StatGroup } from "~/components/admin";
import { ListboxSelect, TextField } from "~/components/forms";
import { Spinner, buttonClass } from "~/components/ui";
import { handleAdminIntent } from "~/lib/admin-actions.server";
import { adminEmailContext } from "~/lib/admin-context";
import { getEventBySlug } from "~/lib/db.server";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime } from "~/lib/format";
import { linkSuggestions, listContacts, listScanners } from "~/lib/scanners.server";

export function meta() {
  return [{ title: "Petugas Scan – PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

export async function loader() {
  const env = getAppEnv();
  const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
  const scanners = await listScanners(env.DB);
  const [suggestions, contacts] = await Promise.all([linkSuggestions(env.DB, scanners), listContacts(env.DB)]);
  return {
    scanners,
    suggestions,
    contacts,
    scannerHost: env.PUBLIC_APP_URL ? null : null,
    eventStarts: event?.starts_at ?? null,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleAdminIntent(getAppEnv(), context.get(adminEmailContext), await request.formData());
}

type Readiness = "ready" | "attention" | "untested" | "failed";
function readiness(s: Route.ComponentProps["loaderData"]["scanners"][number]): Readiness {
  if (s.test_at === null) return "untested";
  return s.test_passed === 1 ? "ready" : "failed";
}

const READY_BADGE: Record<Readiness, { label: string; cls: string }> = {
  ready: { label: "Siap", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  attention: { label: "Perlu perhatian", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  untested: { label: "Belum tes", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  failed: { label: "Gagal tes", cls: "bg-red-50 text-red-700 ring-red-200" },
};

const LEVEL_LABEL = { 1: "Keamanan", 2: "Panitia (meja info)", 3: "Pengurus (bestuur)" } as const;

export default function Scanners({ loaderData }: Route.ComponentProps) {
  const { scanners, suggestions, contacts } = loaderData;
  const active = scanners.filter((s) => s.active === 1);
  const ready = active.filter((s) => readiness(s) === "ready").length;
  const everLoggedIn = active.filter((s) => s.last_login_at).length;
  const unregistered = active.filter((s) => s.registered === 0 && !s.participant_id).length;

  return (
    <div>
      <PageHeader
        eyebrow="Hari-H"
        title={
          <>
            Petugas scan <span className="text-slate-400 tabular-nums">({scanners.length})</span>
          </>
        }
        description="Tim check-in yang memakai aplikasi scan di ponsel sendiri. Terpisah dari daftar admin: petugas tidak dapat membuka dashboard ini."
        actions={
          <Link to="/admin/briefing" className={buttonClass("secondary", "md")}>
            <DocumentTextIcon className="size-4" aria-hidden="true" />
            Lembar briefing
          </Link>
        }
      />

      <div className="space-y-6">
        <StatGroup>
          <Stat label="Petugas aktif" value={active.length} icon={UserGroupIcon} sub={`${active.filter((s) => s.role === "lead").length} ketua tim`} />
          <Stat label="Sudah login" value={everLoggedIn} sub={`dari ${active.length}`} icon={ArrowRightOnRectangleIcon} />
          <Stat label="Perangkat siap" value={ready} sub="lulus uji perangkat" icon={CheckCircleIcon} />
          <Stat label="Belum terdaftar peserta" value={unregistered} sub="belum ada pendaftaran atau tautan" icon={ExclamationTriangleIcon} />
        </StatGroup>

        <AddScanners />

        <Panel title="Papan kesiapan" icon={ShieldCheckIcon} flush>
          {scanners.length === 0 ? (
            <EmptyState icon={UserGroupIcon}>Belum ada petugas. Tambahkan email petugas di atas.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {scanners.map((s) => {
                const r = readiness(s);
                const badge = READY_BADGE[r];
                const mySuggestions = suggestions.filter((x) => x.scannerId === s.id);
                return (
                  <li key={s.id} className="px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                      <div className="min-w-[220px] flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold break-all text-slate-900">{s.name || s.email}</span>
                          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${s.role === "lead" ? "bg-brand-50 text-brand ring-brand-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}>
                            {s.role === "lead" ? "Ketua tim" : "Petugas"}
                          </span>
                          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${badge.cls}`}>{badge.label}</span>
                          {s.active === 0 ? <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200 ring-inset">Nonaktif</span> : null}
                        </div>
                        {s.name ? <div className="text-sm break-all text-slate-600">{s.email}</div> : null}
                        <div className="mt-0.5 text-xs text-slate-500">
                          Login terakhir {s.last_login_at ? formatDateTime(s.last_login_at) : "belum pernah"}
                          {s.sessions > 0 ? ` · ${s.sessions} sesi aktif` : ""}
                          {s.test_at ? ` · tes ${formatDateTime(s.test_at)}${s.test_device ? ` (${s.test_device})` : ""}` : ""}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                          {s.participant_id ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <LinkIcon className="size-3.5" aria-hidden="true" />
                              Ditautkan ke peserta {s.linked_name ?? ""}
                            </span>
                          ) : s.registered > 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircleIcon className="size-3.5" aria-hidden="true" />
                              Terdaftar sebagai pendaftar (email sama): tidak bisa scan tiketnya sendiri
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <XCircleIcon className="size-3.5" aria-hidden="true" />
                              Belum terdaftar sebagai peserta
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ActionButton
                          intent="set-scanner-role"
                          label={s.role === "lead" ? "Jadikan petugas" : "Jadikan ketua tim"}
                          tone="neutral"
                          extra={{ scannerId: String(s.id), role: s.role === "lead" ? "scanner" : "lead" }}
                        />
                        <ActionButton
                          intent="set-scanner-active"
                          label={s.active ? "Nonaktifkan" : "Aktifkan"}
                          tone="neutral"
                          extra={{ scannerId: String(s.id), active: s.active ? "0" : "1" }}
                          confirm={
                            s.active
                              ? {
                                  title: "Nonaktifkan petugas",
                                  description: `${s.email} langsung keluar dari aplikasi scan dan tidak bisa masuk lagi sampai diaktifkan.`,
                                  confirmLabel: "Ya, nonaktifkan",
                                  tone: "danger",
                                  icon: UserMinusIcon,
                                }
                              : undefined
                          }
                        />
                        <ActionButton
                          intent="remove-scanner"
                          label="Hapus"
                          tone="neutral"
                          icon={TrashIcon}
                          extra={{ scannerId: String(s.id) }}
                          confirm={{
                            title: "Hapus petugas",
                            description: `${s.email} dihapus dari tim scan beserta sesi dan hasil tesnya.`,
                            confirmLabel: "Ya, hapus",
                            tone: "danger",
                            icon: UserMinusIcon,
                          }}
                        />
                      </div>
                    </div>
                    {mySuggestions.length > 0 ? (
                      <div className="mt-3 space-y-2 border-l-2 border-amber-500 bg-amber-50/60 px-4 py-3 text-sm">
                        <p className="text-amber-950">Nama petugas cocok dengan peserta di pendaftaran lain. Tautkan agar tidak bisa men-scan tiketnya sendiri:</p>
                        {mySuggestions.map((m) => (
                          <div key={m.participantId} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-slate-800">
                              {m.name} <span className="text-slate-500">({m.registrationLabel})</span>
                            </span>
                            <ActionButton
                              intent="link-scanner-participant"
                              label="Tautkan"
                              tone="primary"
                              icon={LinkIcon}
                              extra={{ scannerId: String(s.id), participantId: m.participantId }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:px-5">
            Petugas yang juga peserta wajib mendaftar seperti peserta lain. Jika emailnya sama dengan email pendaftaran, atau ditautkan ke peserta, aplikasi menolak scan tiket miliknya dan rombongannya. Petugas di-check-in oleh rekan atau ketua tim.
          </p>
        </Panel>

        <Contacts contacts={contacts} />

        <Panel title="Setelah acara atau darurat" icon={ExclamationTriangleIcon}>
          <div className="flex flex-wrap gap-3">
            <ActionButton
              intent="logout-all-scanners"
              label="Keluarkan semua petugas"
              tone="neutral"
              icon={ArrowRightOnRectangleIcon}
              confirm={{ title: "Keluarkan semua petugas", description: "Semua sesi aplikasi scan diakhiri. Petugas harus masuk lagi dengan kode email.", confirmLabel: "Ya, keluarkan", tone: "danger", icon: ArrowRightOnRectangleIcon }}
            />
            <ActionButton
              intent="remove-all-scanners"
              label="Hapus semua petugas"
              tone="neutral"
              icon={TrashIcon}
              confirm={{ title: "Hapus semua petugas", description: "Seluruh daftar petugas, sesi, dan hasil uji perangkat dihapus. Gunakan setelah acara selesai.", confirmLabel: "Ya, hapus semua", tone: "danger", icon: TrashIcon }}
            />
          </div>
          <p className="mt-4 text-xs text-slate-500">Log check-in dianonimkan otomatis 30 hari setelah acara selesai (nama petugas diganti nomor, data perangkat dihapus).</p>
        </Panel>
      </div>
    </div>
  );
}

function AddScanners() {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const formRef = useRef<HTMLFormElement>(null);
  const [role, setRole] = useState("scanner");
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.data?.ok) formRef.current?.reset();
  }, [fetcher.data]);
  return (
    <Panel title="Tambah petugas" icon={UserPlusIcon}>
      <fetcher.Form ref={formRef} method="post" className="grid gap-4 sm:grid-cols-[1fr_14rem] sm:items-start">
        <input type="hidden" name="intent" value="add-scanners" />
        <div className="sm:row-span-2">
          <label htmlFor="scanner-emails" className="mb-1.5 block text-sm font-medium text-slate-700">
            Email dan nama (satu orang per baris)
          </label>
          <textarea
            id="scanner-emails"
            name="emails"
            required
            rows={5}
            placeholder={"nama@email.com, Nama Lengkap\nlain@email.com, Nama Lain"}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs transition duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-none"
          />
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Peran</span>
          <ListboxSelect
            name="role"
            label="Peran"
            value={role}
            onChange={setRole}
            options={[
              { value: "scanner", label: "Petugas" },
              { value: "lead", label: "Ketua tim" },
            ]}
          />
        </div>
        <button type="submit" disabled={busy} className={buttonClass("primary", "md", "w-full")}>
          {busy ? <Spinner /> : <PlusIcon className="size-4" aria-hidden="true" />}
          {busy ? "Menyimpan…" : "Tambah"}
        </button>
      </fetcher.Form>
      <Notice result={fetcher.data} className="mt-4" />
      <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
        <EnvelopeIcon className="size-4 shrink-0" aria-hidden="true" />
        Petugas masuk dengan kode 6 digit yang dikirim ke emailnya (berlaku 48 jam per sesi). Isi nama sama dengan nama di pendaftaran agar dapat ditautkan ke tiketnya sendiri.
      </p>
    </Panel>
  );
}

function Contacts({ contacts }: { contacts: Route.ComponentProps["loaderData"]["contacts"] }) {
  const [editing, setEditing] = useState<(typeof contacts)[number] | null>(null);
  return (
    <Panel title="Kontak eskalasi" icon={LifebuoyIcon} flush>
      <p className="border-b border-slate-100 px-4 py-3 text-sm text-slate-600 sm:px-5">
        Muncul di aplikasi scan sebagai tombol telepon saat ada perselisihan: keamanan, panitia, lalu pengurus (bestuur). Kosong = aplikasi menampilkan &quot;Kontak belum diatur&quot;.
      </p>
      {contacts.length === 0 ? (
        <EmptyState icon={PhoneIcon}>Belum ada kontak. Tambahkan di bawah.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 text-brand">
                {c.level === 3 ? <BuildingOffice2Icon className="size-5" aria-hidden="true" /> : c.level === 2 ? <UserGroupIcon className="size-5" aria-hidden="true" /> : <ShieldCheckIcon className="size-5" aria-hidden="true" />}
              </span>
              <div className="min-w-[200px] flex-1">
                <p className="font-semibold text-slate-900">
                  {c.name} {c.active === 0 ? <span className="text-xs font-normal text-red-600">(disembunyikan)</span> : null}
                </p>
                <p className="text-xs text-slate-500">
                  {LEVEL_LABEL[c.level]}
                  {c.role_label ? ` · ${c.role_label}` : ""} · {c.phone}
                  {c.note ? ` · ${c.note}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setEditing(c)} className={buttonClass("secondary", "sm")}>
                  Ubah
                </button>
                <ActionButton intent="set-contact-active" label={c.active ? "Sembunyikan" : "Tampilkan"} tone="neutral" extra={{ contactId: String(c.id), active: c.active ? "0" : "1" }} />
                <ActionButton
                  intent="delete-contact"
                  label="Hapus"
                  tone="neutral"
                  icon={TrashIcon}
                  extra={{ contactId: String(c.id) }}
                  confirm={{ title: "Hapus kontak", description: `${c.name} dihapus dari daftar kontak eskalasi.`, confirmLabel: "Ya, hapus", tone: "danger", icon: TrashIcon }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <ContactForm key={editing?.id ?? "new"} editing={editing} onDone={() => setEditing(null)} />
    </Panel>
  );
}

function ContactForm({ editing, onDone }: { editing: Route.ComponentProps["loaderData"]["contacts"][number] | null; onDone: () => void }) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const formRef = useRef<HTMLFormElement>(null);
  const [level, setLevel] = useState(String(editing?.level ?? 1));
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.data?.ok) {
      formRef.current?.reset();
      onDone();
    }
  }, [fetcher.data, onDone]);
  return (
    <div className="border-t border-slate-100 px-4 py-4 sm:px-5">
      <p className="mb-3 text-sm font-semibold text-slate-900">{editing ? `Ubah kontak: ${editing.name}` : "Tambah kontak"}</p>
      <fetcher.Form ref={formRef} method="post" className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="intent" value="save-contact" />
        {editing ? <input type="hidden" name="contactId" value={editing.id} /> : null}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Tingkat</span>
          <ListboxSelect
            name="level"
            label="Tingkat eskalasi"
            value={level}
            onChange={setLevel}
            options={[
              { value: "1", label: "1 · Keamanan" },
              { value: "2", label: "2 · Panitia (meja info)" },
              { value: "3", label: "3 · Pengurus (bestuur)" },
            ]}
          />
        </div>
        <TextField name="name" label="Nama" required maxLength={120} defaultValue={editing?.name ?? ""} autoComplete="off" />
        <TextField name="roleLabel" label="Peran (opsional)" maxLength={80} defaultValue={editing?.role_label ?? ""} placeholder="mis. Kepala keamanan" autoComplete="off" />
        <TextField name="phone" label="Telepon" required type="tel" inputMode="tel" defaultValue={editing?.phone ?? ""} placeholder="+31 6 12345678" icon={PhoneIcon} autoComplete="off" />
        <TextField name="note" label="Catatan (opsional)" maxLength={200} defaultValue={editing?.note ?? ""} className="sm:col-span-2" autoComplete="off" />
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button type="submit" disabled={busy} className={buttonClass("primary", "md")}>
            {busy ? <Spinner /> : <CheckCircleIcon className="size-4" aria-hidden="true" />}
            {busy ? "Menyimpan…" : editing ? "Simpan" : "Tambah kontak"}
          </button>
          {editing ? (
            <button type="button" onClick={onDone} className={buttonClass("secondary", "md")}>
              Batal
            </button>
          ) : null}
        </div>
      </fetcher.Form>
      <Notice result={fetcher.data} className="mt-3" />
    </div>
  );
}
