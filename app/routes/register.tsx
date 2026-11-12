import { LockClosedIcon, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";
import { data, useNavigation } from "react-router";
import { waitUntil } from "cloudflare:workers";

import type { Route } from "./+types/register";
import { HeaderSection } from "~/components/register/HeaderSection";
import { RegistrationForm } from "~/components/register/RegistrationForm";
import { SuccessPanel } from "~/components/register/SuccessPanel";
import { Backdrop, Callout } from "~/components/ui";
import { bankConfigured, bankInfo, emailConfig, featureEnabled, isDev } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";
import { getEventBySlug } from "~/lib/db.server";
import { deliverEmail } from "~/lib/email/send.server";
import { quotaSummary, registerOnline, registrationWindowError } from "~/lib/registration.server";
import { verifyTurnstile } from "~/lib/turnstile.server";
import { formToRegistrationDraft, registrationSchema, toFieldErrors, type FieldErrors } from "~/lib/validation";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `Pendaftaran ${loaderData.event.title}` : "Pendaftaran" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const appEnv = getAppEnv();
  if (!featureEnabled(appEnv, "public")) throw data("Tidak ditemukan.", { status: 404 });
  const event = await getEventBySlug(appEnv.DB, params.slug);
  if (!event) throw data("Acara tidak ditemukan.", { status: 404 });
  const windowError = registrationWindowError(event, new Date());
  // "Pendaftaran ditutup otomatis bila kuota penuh": per group, and fully closed when both groups are full.
  const quota = await quotaSummary(appEnv.DB, event);
  const memberFull = quota.member.remaining <= 0;
  const nonMemberFull = quota.nonMember.remaining <= 0;
  const quotaClosed =
    memberFull && nonMemberFull ? "Pendaftaran ditutup karena kuota peserta sudah terpenuhi." : null;
  return {
    event: {
      slug: event.slug,
      title: event.title,
      speaker: event.speaker,
      theme: event.theme,
      infoUrl: event.info_url,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      registrationClosesAt: event.registration_closes_at,
      maxFamily: event.max_family,
      priceCents: event.price_non_member_cents,
      payWindowHours: Math.round(event.pay_window_min / 60),
    },
    siteKey: appEnv.TURNSTILE_SITE_KEY ?? "",
    quotaFull: { member: memberFull, nonMember: nonMemberFull },
    windowError: quotaClosed ?? (isDev(appEnv) ? null : windowError),
    devNotice: isDev(appEnv) && windowError ? `Mode lokal: "${windowError}" diabaikan.` : null,
  };
}

type ActionData =
  | { ok: false; errors: FieldErrors; message: string }
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

export async function action({ request, params }: Route.ActionArgs) {
  const appEnv = getAppEnv();
  if (!featureEnabled(appEnv, "public")) throw data("Tidak ditemukan.", { status: 404 });
  const event = await getEventBySlug(appEnv.DB, params.slug);
  if (!event) throw data("Acara tidak ditemukan.", { status: 404 });
  const form = await request.formData();

  const turnstile = await verifyTurnstile(
    appEnv.TURNSTILE_SECRET,
    form.get("cf-turnstile-response")?.toString() ?? null,
    request.headers.get("CF-Connecting-IP"),
  );
  if (!turnstile.success) {
    // Only the Cloudflare error codes are logged (never the secret or the token), so a misconfiguration is diagnosable.
    console.error("turnstile verification failed:", turnstile.errorCodes.join(",") || "unknown");
    return data<ActionData>(
      {
        ok: false,
        errors: {},
        message: "Verifikasi keamanan gagal atau kedaluwarsa. Silakan centang verifikasi lalu kirim ulang.",
      },
      { status: 400 },
    );
  }

  const parsed = registrationSchema(event.max_family, new Date().getFullYear()).safeParse(
    formToRegistrationDraft(form),
  );
  if (!parsed.success) {
    return data<ActionData>(
      { ok: false, errors: toFieldErrors(parsed.error), message: "Periksa kembali isian yang ditandai." },
      { status: 400 },
    );
  }

  if (parsed.data.membership === "Tidak" && !bankConfigured(appEnv)) {
    console.error("BANK_ACCOUNT_NAME / BANK_IBAN are not configured: refusing a non-member registration");
    return data<ActionData>(
      {
        ok: false,
        errors: {},
        message: "Pengaturan rekening pembayaran belum lengkap. Silakan hubungi panitia.",
      },
      { status: 503 },
    );
  }

  const result = await registerOnline(appEnv.DB, event, parsed.data, { ignoreWindow: isDev(appEnv) });
  const cfg = emailConfig(appEnv);

  switch (result.kind) {
    case "accepted":
      waitUntil(deliverEmail(appEnv.DB, cfg, result.registrationId, "confirmation"));
      return data<ActionData>({ ok: true, kind: "accepted", people: result.people, email: parsed.data.email });
    case "pending_payment":
      waitUntil(deliverEmail(appEnv.DB, cfg, result.registrationId, "payment_instructions"));
      return data<ActionData>({
        ok: true,
        kind: "pending_payment",
        people: result.people,
        email: parsed.data.email,
        paymentCode: result.paymentCode,
        amountCents: result.amountCents,
        payDeadline: result.payDeadline,
        bank: bankInfo(appEnv),
      });
    case "rejected_quota":
      return data<ActionData>(
        {
          ok: false,
          errors: {},
          message: `Mohon maaf, kuota tidak mencukupi. Sisa kuota: ${result.remaining} orang; jumlah peserta Anda: ${result.people} orang.`,
        },
        { status: 409 },
      );
    case "duplicate_email":
      return data<ActionData>(
        {
          ok: false,
          errors: { email: "Email ini sudah memiliki pendaftaran aktif." },
          message:
            "Email ini sudah memiliki pendaftaran aktif untuk acara ini. Periksa kotak masuk Anda atau hubungi panitia.",
        },
        { status: 409 },
      );
    case "closed":
      return data<ActionData>({ ok: false, errors: {}, message: result.reason }, { status: 409 });
  }
}

export default function Register({ loaderData, actionData }: Route.ComponentProps) {
  const { event, siteKey, windowError, devNotice, quotaFull } = loaderData;
  const result = actionData as ActionData | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  if (result?.ok) {
    return (
      <PageShell>
        <SuccessPanel result={result} eventTitle={event.title} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <HeaderSection event={event} />

      {devNotice ? (
        <div className="px-5 pb-6 sm:px-8 lg:px-10">
          <Callout tone="neutral" icon={WrenchScrewdriverIcon}>
            <p>{devNotice}</p>
          </Callout>
        </div>
      ) : null}

      {windowError ? (
        <div className="border-t border-slate-200/80 px-5 py-10 sm:px-8 lg:px-10">
          <Callout tone="danger" role="status" icon={LockClosedIcon} title="Pendaftaran tidak tersedia">
            <p>{windowError}</p>
          </Callout>
        </div>
      ) : (
        <RegistrationForm
          event={event}
          siteKey={siteKey}
          quotaFull={quotaFull}
          failure={result && !result.ok ? result : undefined}
          submitting={submitting}
        />
      )}
    </PageShell>
  );
}

/** Edge-to-edge sheet on phones; a thin-bordered glass column with a brand top rule from sm upwards. */
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <Backdrop>
      <main className="mx-auto max-w-6xl sm:px-6 sm:py-10 lg:py-14">
        <article className="relative overflow-hidden border-b border-slate-200/80 bg-white/80 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_24px_48px_-28px_rgb(15_23_42/0.18)] backdrop-blur-md sm:border">
          <div className="h-1 bg-gradient-to-r from-brand via-brand to-brand-dark" aria-hidden="true" />
          {children}
        </article>
        <footer className="flex flex-col gap-1 px-5 py-6 text-[13px] text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-0">
          <p>
            Panitia Kajian{" "}
            <a className="font-semibold text-brand hover:text-brand-dark" href="https://www.ppmedenhaag.nl/">
              PPME Den Haag
            </a>
          </p>
          <p>Semua waktu dalam waktu Belanda (Europe/Amsterdam).</p>
        </footer>
      </main>
    </Backdrop>
  );
}
