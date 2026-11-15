import { ArrowLeftStartOnRectangleIcon, ArrowRightIcon, InformationCircleIcon, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";
import { Form, Link, data, redirect, useActionData, useNavigation } from "react-router";
import { waitUntil } from "cloudflare:workers";

import type { Route } from "./+types/my-registration";
import { ManageRegistration, type SaveResult } from "~/components/register/ManageRegistration";
import { PageShell } from "~/components/register/PageShell";
import { RegistrantCodeStep, RegistrantEmailStep } from "~/components/register/RegistrantAccess";
import { Callout, Eyebrow, Logo, Spinner, buttonClass } from "~/components/ui";
import { normalizeEmail } from "~/lib/admins.server";
import { isSameOrigin, requestMeta } from "~/lib/auth.server";
import { bankConfigured, bankInfo, emailConfig, featureEnabled, isDev } from "~/lib/config.server";
import { getEventBySlug, getParticipants } from "~/lib/db.server";
import { deliverEmail } from "~/lib/email/send.server";
import { getAppEnv } from "~/lib/env.server";
import { CODE_COOLDOWN_MS, CODE_TTL_MS, isValidEmail } from "~/lib/login-codes.server";
import {
  clearRegistrantCookie,
  createRegistrantSession,
  destroyRegistrantSession,
  identifyRegistrant,
  registrantCookie,
  registrantPath,
  requestRegistrantCode,
  verifyRegistrantCode,
} from "~/lib/registrant-access.server";
import { cancelOwnRegistration, getActiveRegistrationByEmail, lockMessage, selfEditState, updateOwnRegistration } from "~/lib/self-service.server";
import { verifyTurnstile } from "~/lib/turnstile.server";
import { selfEditSchema, formToSelfEditDraft, toFieldErrors } from "~/lib/validation";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData ? `Pendaftaran Saya – ${loaderData.event.title}` : "Pendaftaran Saya" },
    { name: "robots", content: "noindex" },
  ];
}

async function loadEvent(slug: string) {
  const env = getAppEnv();
  if (!featureEnabled(env, "public")) throw data("Tidak ditemukan.", { status: 404 });
  const event = await getEventBySlug(env.DB, slug);
  if (!event) throw data("Acara tidak ditemukan.", { status: 404 });
  return { env, event };
}

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const { env, event } = await loadEvent(params.slug);
  const base = {
    event: { slug: event.slug, title: event.title },
    siteKey: env.TURNSTILE_SITE_KEY?.trim() ?? "",
    devLog: isDev(env) && env.EMAIL_MODE !== "resend",
    validMinutes: CODE_TTL_MS / 60_000,
    cooldownSeconds: Math.round(CODE_COOLDOWN_MS / 1000),
    contact: emailConfig(env).replyTo,
    loggedOut: url.searchParams.has("keluar"),
    cancelled: url.searchParams.has("dibatalkan"),
  };

  const session = await identifyRegistrant(env.DB, request, event.id);
  if (!session) return { ...base, view: "login" as const };

  const reg = await getActiveRegistrationByEmail(env.DB, event.id, session.email);
  if (!reg) return { ...base, view: "none" as const, email: session.email };

  const participants = await getParticipants(env.DB, reg.id);
  const state = selfEditState(reg, event, new Date(), { ignoreWindow: isDev(env) });
  return {
    ...base,
    view: "registration" as const,
    email: session.email,
    registration: {
      registrantName: reg.registrant_name,
      whatsapp: reg.whatsapp ?? "",
      email: reg.email ?? session.email,
      isMember: reg.is_member === 1,
      status: reg.status as "accepted" | "pending_payment" | "pending_membership",
      paymentStatus: reg.payment_status,
      paymentCode: reg.payment_code,
      amountCents: reg.amount_cents,
      payDeadline: reg.pay_deadline,
      paidAt: reg.paid_at,
      createdAt: reg.created_at,
      editRev: reg.edit_rev ?? "",
    },
    participants: participants.map((p) => ({
      id: p.id,
      name: p.full_name,
      gender: p.gender ?? "",
      ageGroup: p.age_group,
      hasTicket: !!p.qr_token && p.status === "accepted",
    })),
    state: state.editable
      ? state
      : { editable: false as const, message: lockMessage(state.reason), paid: state.reason === "paid" },
    canAdd: event.self_add_allowed === 1,
    // Cancelling follows the same window as editing (freeze once registration closes, decision 14 Nov 2026).
    canCancel: state.editable,
    priceCents: event.price_non_member_cents,
    maxFamily: event.max_family,
    bank: reg.status === "pending_payment" && bankConfigured(env) ? bankInfo(env) : null,
  };
}

type ActionData =
  | { step: "email"; email: string; error: string }
  | { step: "code"; email: string; sentAt: number; resent?: boolean; error?: string }
  | { step: "save"; result: SaveResult };

export async function action({ request, params, url }: Route.ActionArgs) {
  const { env, event } = await loadEvent(params.slug);
  if (!isSameOrigin(request)) throw data("Permintaan ditolak.", { status: 403 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const path = registrantPath(event.slug);

  if (intent === "logout") {
    await destroyRegistrantSession(env.DB, request);
    throw redirect(`${path}?keluar`, { headers: { "Set-Cookie": clearRegistrantCookie(request) } });
  }

  if (intent === "cancel") {
    const session = await identifyRegistrant(env.DB, request, event.id);
    if (!session) {
      return data<ActionData>(
        { step: "email", email: "", error: "Sesi Anda sudah berakhir. Masukkan email Anda untuk meminta kode baru." },
        { status: 401 },
      );
    }
    const res = await cancelOwnRegistration(env.DB, event, session.email, String(form.get("rev") ?? ""), {
      ignoreWindow: isDev(env),
    });
    if (!res.ok) {
      return data<ActionData>(
        { step: "save", result: { ok: false, message: res.message, errors: {} } },
        { status: res.reason === "stale" ? 409 : 400 },
      );
    }
    // Their sessions are deleted with the registration; clear the cookie too.
    throw redirect(`${path}?dibatalkan`, { headers: { "Set-Cookie": clearRegistrantCookie(request) } });
  }

  if (intent === "save") {
    const session = await identifyRegistrant(env.DB, request, event.id);
    if (!session) {
      return data<ActionData>(
        { step: "email", email: "", error: "Sesi Anda sudah berakhir. Masukkan email Anda untuk meminta kode baru." },
        { status: 401 },
      );
    }
    const parsed = selfEditSchema(event.max_family).safeParse(formToSelfEditDraft(form));
    if (!parsed.success) {
      return data<ActionData>(
        {
          step: "save",
          result: { ok: false, message: "Periksa kembali isian yang ditandai.", errors: toFieldErrors(parsed.error) },
        },
        { status: 400 },
      );
    }
    const res = await updateOwnRegistration(env.DB, event, session.email, String(form.get("rev") ?? ""), parsed.data, {
      ignoreWindow: isDev(env),
    });
    if (!res.ok) {
      return data<ActionData>(
        { step: "save", result: { ok: false, message: res.message, errors: {} } },
        { status: res.reason === "quota" || res.reason === "stale" ? 409 : 400 },
      );
    }
    if (!res.changed) {
      return data<ActionData>({ step: "save", result: { ok: true, message: "Tidak ada perubahan untuk disimpan." } });
    }
    // The QR (confirmation) email is NOT rendered in this public request: it is already re-queued in the outbox by the
    // edit and the 5-minute cron sends it. The light emails (no QR images) still go out right away.
    const viaCron = res.email === "confirmation";
    if (res.email && !viaCron) waitUntil(deliverEmail(env.DB, emailConfig(env), res.registrationId, res.email));
    return data<ActionData>({
      step: "save",
      result: {
        ok: true,
        message: res.email
          ? viaCron
            ? `Perubahan disimpan. Email dengan QR Code terbaru dikirim ke ${session.email} dalam beberapa menit (maksimal sekitar 10 menit).`
            : `Perubahan disimpan. Email dengan data terbaru dikirim ke ${session.email}.`
          : "Perubahan disimpan.",
      },
    });
  }

  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!isValidEmail(email)) {
    return data<ActionData>({ step: "email", email, error: "Masukkan alamat email yang valid." }, { status: 400 });
  }

  if (intent === "request") {
    // Every code request (also "Kirim ulang") needs a Turnstile pass, so bots cannot make us send email.
    const resend = form.get("resend") === "1";
    const turnstile = await verifyTurnstile(
      env.TURNSTILE_SECRET,
      form.get("cf-turnstile-response")?.toString() ?? null,
      request.headers.get("CF-Connecting-IP"),
    );
    if (!turnstile.success) {
      console.error("registrant turnstile failed:", turnstile.errorCodes.join(",") || "unknown");
      const error = "Verifikasi keamanan gagal atau kedaluwarsa. Silakan selesaikan verifikasi lalu coba lagi.";
      return data<ActionData>(
        resend
          ? { step: "code", email, sentAt: Number(form.get("sentAt")) || Date.now(), error }
          : { step: "email", email, error },
        { status: 400 },
      );
    }
    // Same answer whether a code was sent, the email has no active registration, or it was rate-limited.
    await requestRegistrantCode(env.DB, emailConfig(env), event, email, { ...requestMeta(request), appOrigin: url.origin });
    return data<ActionData>({ step: "code", email, sentAt: Date.now(), resent: resend });
  }

  if (intent === "verify") {
    const sentAt = Number(form.get("sentAt")) || Date.now();
    const result = await verifyRegistrantCode(env.DB, event.id, email, String(form.get("code") ?? ""));
    if (!result.ok) return data<ActionData>({ step: "code", email, sentAt, error: result.message }, { status: 400 });
    const session = await createRegistrantSession(env.DB, event.id, email, requestMeta(request));
    if (!session) {
      return data<ActionData>(
        { step: "email", email, error: "Tidak ada pendaftaran aktif untuk email ini." },
        { status: 403 },
      );
    }
    throw redirect(path, { headers: { "Set-Cookie": registrantCookie(request, session.token) } });
  }

  throw data("Permintaan tidak dikenal.", { status: 400 });
}

export default function MyRegistrationPage({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<ActionData>();
  const d = loaderData;
  const path = registrantPathClient(d.event.slug);

  return (
    <PageShell>
      <header className="px-5 pt-7 pb-6 sm:px-8 sm:pt-10 lg:px-10 lg:pt-12">
        <div className="flex items-start justify-between gap-4 sm:gap-8">
          <div className="min-w-0">
            <Eyebrow className="flex items-center gap-2 text-brand">
              <span className="inline-block size-1.5 rounded-full bg-brand" aria-hidden="true" />
              Pendaftaran Saya
            </Eyebrow>
            <h1 className="text-gradient-brand mt-3 text-[1.75rem] leading-[1.12] font-bold tracking-tight text-balance sm:text-4xl">
              {d.view === "registration" ? "Lihat & ubah pendaftaran" : "Buka pendaftaran Anda"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">{d.event.title}</p>
          </div>
          <Logo className="h-11 w-auto sm:h-14 lg:h-16" />
        </div>
        {d.view !== "login" ? <SessionBar email={d.email} /> : null}
      </header>

      {d.view === "registration" ? (
        <ManageRegistration
          registration={d.registration}
          participants={d.participants}
          state={d.state}
          priceCents={d.priceCents}
          canAdd={d.canAdd}
          canCancel={d.canCancel}
          maxFamily={d.maxFamily}
          contact={d.contact}
          bank={d.bank}
          result={actionData?.step === "save" ? actionData.result : undefined}
        />
      ) : d.view === "none" ? (
        <div className="border-t border-slate-200/80 px-5 py-8 sm:px-8 lg:px-10">
          <Callout tone="neutral" icon={InformationCircleIcon} title="Tidak ada pendaftaran aktif">
            <p>
              Email ini tidak (lagi) memiliki pendaftaran aktif untuk acara ini, misalnya karena batas pembayaran sudah
              lewat. Anda dapat mendaftar kembali selama pendaftaran masih dibuka, atau hubungi panitia di{" "}
              <a className="font-semibold text-brand underline" href={`mailto:${d.contact}`}>
                {d.contact}
              </a>
              .
            </p>
          </Callout>
          <Link to={`/e/${d.event.slug}`} className={buttonClass("primary", "md", "mt-6")}>
            Ke formulir pendaftaran
            <ArrowRightIcon className="size-4" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <div className="border-t border-slate-200/80 px-5 py-8 sm:px-8 lg:px-10">
          <div className="max-w-xl">
            {actionData?.step === "code" ? (
              <RegistrantCodeStep
                key={actionData.sentAt}
                email={actionData.email}
                sentAt={actionData.sentAt}
                resent={!!actionData.resent}
                error={actionData.error}
                validMinutes={d.validMinutes}
                cooldown={d.cooldownSeconds}
                siteKey={d.siteKey}
                backTo={path}
              />
            ) : (
              <RegistrantEmailStep
                siteKey={d.siteKey}
                defaultEmail={actionData?.step === "email" ? actionData.email : ""}
                error={actionData?.step === "email" ? actionData.error : null}
                notice={
                  actionData
                    ? null
                    : d.cancelled
                      ? "Pendaftaran Anda telah dibatalkan dan datanya dihapus. Kursi dikembalikan ke kuota."
                      : d.loggedOut
                        ? "Anda telah keluar dari halaman pendaftaran."
                        : null
                }
              />
            )}
            {d.devLog ? (
              <Callout tone="warning" icon={WrenchScrewdriverIcon} className="mt-6 text-[13px]">
                Mode lokal: email tidak dikirim. Kode akses tampil di terminal <code>npm run dev</code> dan di /admin/outbox.
              </Callout>
            ) : null}
            <p className="mt-8 text-sm text-slate-500">
              Belum mendaftar?{" "}
              <Link to={`/e/${d.event.slug}`} className="font-semibold text-brand hover:text-brand-dark">
                Isi formulir pendaftaran
              </Link>
            </p>
          </div>
        </div>
      )}
    </PageShell>
  );
}

/** Client-safe copy of registrantPath (the server module must not be imported by the component). */
const registrantPathClient = (slug: string) => `/e/${slug}/pendaftaran-saya`;

function SessionBar({ email }: { email: string }) {
  const nav = useNavigation();
  const busy = nav.state !== "idle" && nav.formData?.get("intent") === "logout";
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-4 text-sm text-slate-600">
      <p>
        Masuk sebagai <span className="font-semibold break-all text-slate-900">{email}</span>
      </p>
      <Form method="post">
        <input type="hidden" name="intent" value="logout" />
        <button type="submit" disabled={busy} className={buttonClass("ghost", "sm", "-mr-3")}>
          {busy ? <Spinner /> : <ArrowLeftStartOnRectangleIcon className="size-4" aria-hidden="true" />}
          Keluar
        </button>
      </Form>
    </div>
  );
}
