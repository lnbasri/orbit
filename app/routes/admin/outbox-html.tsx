import { data } from "react-router";

import type { Route } from "./+types/outbox-html";
import type { Attachment } from "~/lib/email/send.server";
import { getAppEnv } from "~/lib/env.server";

// Renders one outbox email with its inline QR images (cid: → data: URIs). Shown in a sandboxed iframe.
export async function loader({ params }: Route.LoaderArgs) {
  const env = getAppEnv();
  const row = await env.DB.prepare("SELECT html, attachments_json FROM dev_outbox WHERE id = ?")
    .bind(Number(params.id))
    .first<{ html: string; attachments_json: string }>();
  if (!row) throw data("Tidak ditemukan", { status: 404 });

  const attachments = JSON.parse(row.attachments_json) as Attachment[];
  let html = row.html;
  for (const a of attachments) {
    html = html.replaceAll(`cid:${a.contentId}`, `data:${a.contentType};base64,${a.contentBase64}`);
  }
  return new Response(`<!doctype html><meta charset="utf-8"><body style="margin:16px">${html}</body>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      "Cache-Control": "no-store",
    },
  });
}
