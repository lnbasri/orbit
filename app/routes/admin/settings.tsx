import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import {
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  InformationCircleIcon,
  LockClosedIcon,
  LockOpenIcon,
} from "@heroicons/react/24/outline";

import type { Route } from "./+types/settings";
import { Notice, PageHeader, Panel } from "~/components/admin";
import { TextField } from "~/components/forms";
import { Callout, Spinner, buttonClass } from "~/components/ui";
import { handleAdminIntent } from "~/lib/admin-actions.server";
import { adminEmailContext } from "~/lib/admin-context";
import { getEventBySlug } from "~/lib/db.server";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime, utcIsoToLocalInput } from "~/lib/format";
import { registrationWindowError } from "~/lib/registration.server";

export function meta() {
  return [{ title: "Pengaturan Acara – PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

export async function loader() {
  const env = getAppEnv();
  const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
  if (!event) throw new Response("Acara tidak ditemukan.", { status: 404 });
  return {
    title: event.title,
    startsAt: event.starts_at,
    opensAt: utcIsoToLocalInput(event.registration_opens_at),
    closesAt: utcIsoToLocalInput(event.registration_closes_at),
    closesAtUtc: event.registration_closes_at,
    state: registrationWindowError(event, new Date()), // null = open right now
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleAdminIntent(getAppEnv(), context.get(adminEmailContext), await request.formData());
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { title, startsAt, opensAt, closesAt, closesAtUtc, state } = loaderData;
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const busy = fetcher.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);

  // Keep the inputs in sync with what was saved (also after a reload of the loader).
  useEffect(() => {
    if (!formRef.current) return;
    (formRef.current.elements.namedItem("opensAt") as HTMLInputElement).value = opensAt;
    (formRef.current.elements.namedItem("closesAt") as HTMLInputElement).value = closesAt;
  }, [opensAt, closesAt]);

  return (
    <div>
      <PageHeader eyebrow="Pengaturan" title="Pengaturan acara" description={title} />

      <Panel title="Jadwal pendaftaran online" icon={CalendarDaysIcon}>
        <Callout tone={state ? "warning" : "success"} icon={state ? LockClosedIcon : LockOpenIcon} className="mb-6">
          <p>
            <span className="font-semibold">{state ? `Saat ini: ${state}` : "Saat ini pendaftaran dibuka."}</span>
            {closesAtUtc ? ` Batas pendaftaran: ${formatDateTime(closesAtUtc)} waktu Belanda.` : " Tidak ada batas pendaftaran."}
          </p>
        </Callout>

        <fetcher.Form ref={formRef} method="post" className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="intent" value="save-event-settings" />
          <TextField name="opensAt" type="datetime-local" label="Pendaftaran dibuka" defaultValue={opensAt} />
          <TextField name="closesAt" type="datetime-local" label="Batas pendaftaran (ditutup)" defaultValue={closesAt} />
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
              {busy ? <Spinner /> : <CheckCircleIcon className="size-4" aria-hidden="true" />}
              {busy ? "Menyimpan…" : "Simpan jadwal"}
            </button>
          </div>
        </fetcher.Form>
        <Notice result={fetcher.data} className="mt-4" />
        <ul className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
          <Hint icon={ClockIcon}>Waktu dalam zona waktu Belanda (Europe/Amsterdam).</Hint>
          <Hint icon={CalendarDaysIcon}>
            Kosongkan kolom untuk tanpa batas. Pendaftaran selalu berakhir saat acara dimulai ({formatDateTime(startsAt)}).
          </Hint>
          <Hint icon={LockClosedIcon}>
            Pendaftaran juga ditutup otomatis bila kuota sudah penuh, berapa pun batas waktunya.
          </Hint>
          <Hint icon={InformationCircleIcon}>Perubahan berlaku seketika di formulir publik.</Hint>
        </ul>
      </Panel>
    </div>
  );
}

function Hint({ icon: Icon, children }: { icon: typeof ClockIcon; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}
