import {
  ArrowUpRightIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  MicrophoneIcon,
  QrCodeIcon,
  UserGroupIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";

import { Callout, Eyebrow, Logo } from "~/components/ui";
import { formatEuro, formatLongDate, formatTime } from "~/lib/format";
import { EventDetailRow } from "./EventDetailRow";

export interface PublicEvent {
  slug: string;
  title: string;
  speaker: string | null;
  theme: string | null;
  infoUrl: string | null;
  startsAt: string;
  endsAt: string;
  registrationClosesAt: string | null;
  maxFamily: number;
  priceCents: number;
  payWindowHours: number;
}

/** Title row (title + logo), greeting, event metadata grid and the registration rules. */
export function HeaderSection({ event }: { event: PublicEvent }) {
  return (
    <header>
      <div className="px-5 pt-7 sm:px-8 sm:pt-10 lg:px-10 lg:pt-12">
        <div className="flex items-start justify-between gap-4 sm:gap-8">
          <div className="min-w-0">
            <Eyebrow className="flex items-center gap-2 text-brand">
              <span className="inline-block size-1.5 rounded-full bg-brand" aria-hidden="true" />
              Pendaftaran peserta
            </Eyebrow>
            <h1 className="text-gradient-brand mt-3 text-[1.75rem] leading-[1.12] font-bold tracking-tight text-balance sm:text-4xl lg:text-[2.75rem]">
              {event.title}
            </h1>
          </div>
          <Logo className="h-11 w-auto sm:h-14 lg:h-16" />
        </div>

        <div className="mt-6 max-w-3xl space-y-2 text-[15px] leading-relaxed text-slate-600 sm:text-base">
          <p className="font-semibold text-slate-900">Assalamu'alaikum warahmatullahi wabarakatuh.</p>
          <p>
            Panitia Kajian PPME Den Haag membuka pendaftaran peserta kajian
            {event.speaker ? (
              <>
                {" "}
                bersama <span className="font-semibold text-slate-900">{event.speaker}</span>
              </>
            ) : null}
            {event.theme ? <> dengan tema “{event.theme}”</> : null}.
          </p>
          {event.infoUrl ? (
            <a
              href={event.infoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1.5 rounded-sm pt-1 text-sm font-semibold text-brand hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Info lengkap acara
              <ArrowUpRightIcon
                className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                aria-hidden="true"
              />
            </a>
          ) : null}
        </div>
      </div>

      <dl className="mt-8 grid gap-px border-y border-slate-200/80 bg-slate-200/80 sm:grid-cols-2 lg:grid-cols-4">
        <EventDetailRow icon={CalendarDaysIcon} label="Tanggal" value={formatLongDate(event.startsAt)} />
        <EventDetailRow
          icon={ClockIcon}
          label="Waktu"
          value={`${formatTime(event.startsAt)} – ${formatTime(event.endsAt)}`}
          sub="Waktu Belanda"
        />
        {event.speaker ? (
          <EventDetailRow icon={MicrophoneIcon} label="Pemateri" value={event.speaker} />
        ) : (
          <EventDetailRow icon={UserGroupIcon} label="Penyelenggara" value="PPME Den Haag" />
        )}
        {event.registrationClosesAt ? (
          <EventDetailRow
            icon={LockClosedIcon}
            label="Batas pendaftaran"
            value={formatLongDate(event.registrationClosesAt)}
            sub={`Pukul ${formatTime(event.registrationClosesAt)} waktu Belanda`}
          />
        ) : (
          <EventDetailRow
            icon={BanknotesIcon}
            label="Biaya"
            value="Anggota gratis"
            sub={`Non-anggota ${formatEuro(event.priceCents)} per orang`}
          />
        )}
      </dl>

      <div className="grid gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10 lg:px-10">
        <Callout tone="warning" role="note" icon={ExclamationTriangleIcon} title="Catatan penting" className="self-start">
          <p>
            Pendaftaran ditutup otomatis apabila kuota peserta sudah terpenuhi. Setelah kuota dinyatakan penuh, panitia
            tidak melayani telepon maupun email, dan tidak menerima keluhan dari calon peserta (jamaah) yang sudah
            mendaftar tetapi belum menerima konfirmasi atau QR Code.
          </p>
          <p className="font-medium">Pastikan alamat email Anda benar, dan periksa juga folder spam.</p>
        </Callout>

        <div>
          <h2 className="text-sm font-semibold text-slate-900">Ketentuan pendaftaran</h2>
          <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-slate-600">
            <Rule icon={UsersIcon}>
              Pendaftaran perorangan atau keluarga, maksimal {event.maxFamily} orang termasuk pendaftar.
            </Rule>
            <Rule icon={UserGroupIcon}>
              Pendaftaran ditolak bila kuota tidak mencukupi untuk seluruh peserta yang didaftarkan.
            </Rule>
            <Rule icon={BanknotesIcon}>
              Anggota PPME Den Haag gratis. Non-anggota:{" "}
              <span className="font-semibold text-slate-900">{formatEuro(event.priceCents)} per orang</span>, dibayar
              dalam <span className="font-semibold text-slate-900">{event.payWindowHours} jam</span> setelah mendaftar.
            </Rule>
            <Rule icon={QrCodeIcon}>
              QR Code dikirim lewat email setelah pendaftaran diterima atau pembayaran dikonfirmasi.
            </Rule>
            <Rule icon={CheckCircleIcon}>Setiap QR Code hanya dapat digunakan satu kali saat check-in.</Rule>
          </ul>
        </div>
      </div>
    </header>
  );
}

function Rule({ icon: Icon, children }: { icon: typeof UsersIcon; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}
