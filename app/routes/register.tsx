import { LockClosedIcon, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";
import { data, useNavigation } from "react-router";
import { waitUntil } from "cloudflare:workers";

import type { Route } from "./+types/register";
import { HeaderSection } from "~/components/register/HeaderSection";
import { RegistrationForm } from "~/components/register/RegistrationForm";
import { SuccessPanel } from "~/components/register/SuccessPanel";
import { PageShell } from "~/components/register/PageShell";
import { Callout, buttonClass } from "~/components/ui";
import { Link } from "react-router";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import { bankConfigured, bankInfo, emailConfig, featureEnabled, isDev } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";
import { getEventBySlug } from "~/lib/db.server";
import { formatHijriDate } from "~/lib/format";
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
  const now = new Date();
  const windowError = registrationWindowError(event, now);
  const nonMemberOpen = !event.non_member_opens_at || now.toISOString() >= event.non_member_opens_at;
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
      locationName: event.location_name,
      locationAddress: event.location_address,
      locationMapUrl: event.location_map_url,
      startsAt: event.starts_at,
      startsAtHijri: formatHijriDate(event.starts_at), // computed here so server and browser render the same text
      endsAt: event.ends_at,
      registrationClosesAt: event.registration_closes_at,
      nonMemberOpensAt: event.non_member_opens_at,
      maxFamily: event.max_family,
      infaqUrl: event.infaq_url,
      priceCents: event.price_non_member_cents,
      payWindowHours: Math.round(event.pay_window_min / 60),
    },
    siteKey: appEnv.TURNSTILE_SITE_KEY ?? "",
    quotaFull: { member: memberFull, nonMember: nonMemberFull },
    nonMemberOpen,
    windowError: quotaClosed ?? (isDev(appEnv) ? null : windowError),
    devNotice: isDev(appEnv) && windowError ? `Mode lokal: "${windowError}" diabaikan.` : null,
  };
}

type ActionData =
  | { ok: false; errors: FieldErrors; message: string; manageLink?: boolean }
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

  const parsed = registrationSchema(event.max_family).safeParse(
    formToRegistrationDraft(form),
  );
  if (!parsed.success) {
    return data<ActionData>(
      { ok: false, errors: toFieldErrors(parsed.error), message: "Periksa kembali isian yang ditandai." },
      { status: 400 },
    );
  }

  if (parsed.data.membership === "Tidak" && event.price_non_member_cents > 0 && !bankConfigured(appEnv)) {
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
    case "pending_membership":
      // Members get a "waiting for validation" notice now; the QR code follows once an admin validates the membership.
      waitUntil(deliverEmail(appEnv.DB, cfg, result.registrationId, "membership_pending"));
      return data<ActionData>({ ok: true, kind: "pending_membership", people: result.people, email: parsed.data.email });
    case "accepted":
      // Free event (price 0): accepted at once. The QR email is already in the outbox and is rendered + sent by the
      // 5-minute cron job, NOT here, so the HTTP request never pays the QR rendering CPU. (Also reached by replaying
      // the idempotency key of an earlier registration.)
      return data<ActionData>({ ok: true, kind: "accepted", people: result.people, email: parsed.data.email, member: result.member });
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
          message: `Mohon maaf, kuota tidak mencukupi. Sisa kuota: ${result.remaining} orang; peserta remaja dan dewasa Anda: ${result.seats} orang (balita dan anak tidak dihitung).`,
        },
        { status: 409 },
      );
    case "duplicate_email":
      return data<ActionData>(
        {
          ok: false,
          errors: { email: "Email ini sudah memiliki pendaftaran aktif." },
          message:
            "Email ini sudah memiliki pendaftaran aktif untuk acara ini. Buka \"Pendaftaran Saya\" untuk melihat atau mengubahnya, atau periksa kotak masuk Anda.",
          manageLink: true,
        },
        { status: 409 },
      );
    case "closed":
      return data<ActionData>({ ok: false, errors: {}, message: result.reason }, { status: 409 });
  }
}

export default function Register({ loaderData, actionData }: Route.ComponentProps) {
  const { event, siteKey, windowError, devNotice, quotaFull, nonMemberOpen } = loaderData;
  const result = actionData as ActionData | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  if (result?.ok) {
    return (
      <PageShell>
        <SuccessPanel
          result={result}
          eventTitle={event.title}
          manageUrl={`/e/${event.slug}/pendaftaran-saya`}
          infaqUrl={event.infaqUrl}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <HeaderSection event={event} />
      <ManageLinkBar slug={event.slug} />

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
          nonMemberOpen={nonMemberOpen}
          failure={result && !result.ok ? result : undefined}
          submitting={submitting}
        />
      )}
    </PageShell>
  );
}

/** For people who already registered: view or change the registration (email code). */
function ManageLinkBar({ slug }: { slug: string }) {
  return (
    <div className="flex flex-col gap-3 border-t border-slate-200/80 bg-slate-50/70 px-5 py-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
      <p>Sudah mendaftar? Lihat atau ubah data pendaftaran Anda.</p>
      <Link to={`/e/${slug}/pendaftaran-saya`} className={buttonClass("secondary", "sm", "self-start sm:self-auto")}>
        <PencilSquareIcon className="size-4" aria-hidden="true" />
        Pendaftaran Saya
      </Link>
    </div>
  );
}
