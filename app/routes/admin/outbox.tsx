import { Link, useSearchParams } from "react-router";
import { InboxIcon, PaperClipIcon } from "@heroicons/react/24/outline";

import type { Route } from "./+types/outbox";
import { EmptyState, PageHeader, Panel } from "~/components/admin";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime } from "~/lib/format";

// Local/dev outbox: emails "sent" while EMAIL_MODE=log. Lets you check templates and QR codes.
export async function loader() {
  const env = getAppEnv();
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, kind, to_address, subject, registration_id,
       json_array_length(attachments_json) AS attachments
     FROM dev_outbox ORDER BY id DESC LIMIT 100`,
  ).all<{
    id: number;
    created_at: string;
    kind: string;
    to_address: string;
    subject: string;
    registration_id: string;
    attachments: number;
  }>();
  return { messages: results, mode: env.EMAIL_MODE ?? "log" };
}

export default function Outbox({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const selected = params.get("id") ?? (loaderData.messages[0] ? String(loaderData.messages[0].id) : null);

  return (
    <div>
      <PageHeader
        eyebrow="Pengujian"
        title="Outbox email (lokal)"
        description={
          <>
            Mode email: <span className="font-semibold text-slate-700">{loaderData.mode}</span>. Dalam mode{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">log</code>, email tidak dikirim tetapi disimpan di
            sini lengkap dengan QR Code, untuk pengujian.
          </>
        }
      />
      {loaderData.messages.length === 0 ? (
        <Panel flush>
          <EmptyState icon={InboxIcon}>
            <span>
              Belum ada email. Kirim pendaftaran di{" "}
              <Link className="font-medium text-brand hover:text-brand-dark" to="/">
                formulir
              </Link>
              .
            </span>
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <Panel title={`Pesan (${loaderData.messages.length})`} icon={InboxIcon} flush>
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
              {loaderData.messages.map((m) => {
                const active = String(m.id) === selected;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setParams({ id: String(m.id) })}
                      aria-current={active ? "true" : undefined}
                      className={`w-full border-l-2 px-4 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset ${
                        active ? "border-brand bg-brand-50/70" : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <div className={`font-medium ${active ? "text-brand-dark" : "text-slate-900"}`}>{m.subject}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                        <span className="break-all">{m.to_address}</span>
                        <span className="tabular-nums">{formatDateTime(m.created_at)}</span>
                        {m.attachments ? (
                          <span className="inline-flex items-center gap-0.5">
                            <PaperClipIcon className="size-3.5" aria-hidden="true" />
                            {m.attachments} lampiran
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>
          {selected ? (
            <iframe
              title="Pratinjau email"
              src={`/admin/outbox/${selected}/html`}
              sandbox=""
              className="h-[70vh] w-full rounded-lg border border-slate-200/80 bg-white"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
