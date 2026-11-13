import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { Form, Link, useNavigation } from "react-router";

import { Turnstile } from "~/components/Turnstile";
import { Callout, Spinner, buttonClass } from "~/components/ui";
import { FieldError, TextInputField, inputClass } from "./controls";

function useBusy(intent: string) {
  const nav = useNavigation();
  return nav.state !== "idle" && nav.formData?.get("intent") === intent;
}

/** Step 1: email + Turnstile → a 6-digit access code by email (only when the email has an active registration). */
export function RegistrantEmailStep({
  siteKey,
  defaultEmail,
  error,
  notice,
}: {
  siteKey: string;
  defaultEmail: string;
  error?: string | null;
  notice?: string | null;
}) {
  const busy = useBusy("request");
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      {notice ? (
        <Callout tone="success" icon={CheckCircleIcon} role="status">
          <p>{notice}</p>
        </Callout>
      ) : null}
      {error ? (
        <Callout tone="danger" icon={ExclamationCircleIcon} role="alert">
          <p>{error}</p>
        </Callout>
      ) : null}
      <p className="text-[15px] leading-relaxed text-slate-600">
        Masukkan alamat email yang Anda gunakan saat mendaftar. Kami mengirimkan{" "}
        <span className="font-semibold text-slate-900">kode akses 6 digit</span> ke alamat tersebut untuk membuka
        pendaftaran Anda.
      </p>
      <Form method="post" className="space-y-5">
        <input type="hidden" name="intent" value="request" />
        <TextInputField
          label="Alamat email pendaftaran"
          icon={EnvelopeIcon}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="nama@email.com"
          defaultValue={defaultEmail}
          autoFocus
        />
        {siteKey ? (
          <Turnstile siteKey={siteKey} resetKey={error ?? undefined} onToken={setToken} />
        ) : (
          <Callout tone="danger" icon={ExclamationTriangleIcon} className="text-[13px]">
            Verifikasi keamanan belum dikonfigurasi di server ini, sehingga kode akses tidak dapat dikirim.
          </Callout>
        )}
        <button type="submit" disabled={busy || !token} className={buttonClass("primary", "lg", "w-full sm:w-auto sm:min-w-64")}>
          {busy ? <Spinner /> : null}
          {busy ? "Mengirim kode…" : "Kirim kode akses"}
          {busy ? null : <ArrowRightIcon className="size-4" aria-hidden="true" />}
        </button>
      </Form>
    </div>
  );
}

/** Step 2: enter the code. "Kirim ulang" is a new code request and needs a Turnstile pass too. */
export function RegistrantCodeStep({
  email,
  sentAt,
  resent,
  error,
  validMinutes,
  cooldown,
  siteKey,
  backTo,
}: {
  email: string;
  sentAt: number;
  resent: boolean;
  error?: string;
  validMinutes: number;
  cooldown: number;
  siteKey: string;
  backTo: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const verifying = useBusy("verify");
  const resending = useBusy("request");
  const formRef = useRef<HTMLFormElement>(null);
  const [wait, setWait] = useState(cooldown);
  useEffect(() => {
    const tick = () => setWait(Math.max(0, cooldown - Math.floor((Date.now() - sentAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sentAt, cooldown]);

  return (
    <div className="space-y-6">
      <Callout tone="info" icon={EnvelopeIcon}>
        <p>
          Jika <span className="font-semibold break-all text-slate-900">{email}</span> memiliki pendaftaran aktif untuk
          acara ini, kode akses telah dikirim ke alamat tersebut. Kode berlaku {validMinutes} menit.
        </p>
        <p className="text-slate-500">Tidak ada di kotak masuk? Periksa folder spam atau promosi.</p>
      </Callout>
      {resent && !error ? (
        <Callout tone="success" icon={CheckCircleIcon} role="status">
          <p>Kode baru telah diminta. Kode sebelumnya tidak berlaku lagi.</p>
        </Callout>
      ) : null}

      <Form method="post" ref={formRef} className="space-y-5">
        <input type="hidden" name="intent" value="verify" />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="sentAt" value={sentAt} />
        <div className="max-w-sm">
          <label htmlFor="registrant-code" className="mb-1.5 block text-sm font-medium text-slate-800">
            Kode akses
          </label>
          <input
            id="registrant-code"
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            placeholder="000000"
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              const digits = e.currentTarget.value.replace(/\D/g, "").slice(0, 6);
              if (e.currentTarget.value !== digits) e.currentTarget.value = digits;
              if (digits.length === 6 && !verifying) formRef.current?.requestSubmit();
            }}
            className={`${inputClass(!!error, false)} min-h-14 text-center font-mono text-2xl font-semibold tracking-[0.5em] tabular-nums placeholder:tracking-[0.5em] placeholder:text-slate-300`}
          />
          <FieldError>{error}</FieldError>
        </div>
        <button type="submit" disabled={verifying} className={buttonClass("primary", "lg", "w-full sm:w-auto sm:min-w-64")}>
          {verifying ? <Spinner /> : null}
          {verifying ? "Memeriksa kode…" : "Buka pendaftaran"}
          {verifying ? null : <ArrowRightIcon className="size-4" aria-hidden="true" />}
        </button>
      </Form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-5">
        <Link to={backTo} className={buttonClass("ghost", "sm", "-ml-3")}>
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          Ganti email
        </Link>
        <Form method="post" className="flex flex-col items-end gap-2">
          <input type="hidden" name="intent" value="request" />
          <input type="hidden" name="resend" value="1" />
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="sentAt" value={sentAt} />
          {siteKey ? (
            <Turnstile siteKey={siteKey} appearance="interaction-only" resetKey={error ?? undefined} onToken={setToken} />
          ) : null}
          <button type="submit" disabled={wait > 0 || resending || !token} className={buttonClass("secondary", "sm")}>
            {resending ? <Spinner /> : <ArrowPathIcon className="size-4" aria-hidden="true" />}
            {wait > 0 ? `Kirim ulang (${wait} dtk)` : "Kirim ulang kode"}
          </button>
        </Form>
      </div>
    </div>
  );
}
