import type { Route } from "./+types/unsubscribe";
import { getUnsubscribeToken, unsubscribeByToken } from "~/lib/email.server";
import { getAppEnv } from "~/lib/env.server";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(message: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences — ORBIT</title><body style="font:16px system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:24px;color:#1e293b"><h1>Email preferences</h1>${message}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const record = await getUnsubscribeToken(getAppEnv().DB, token);
  if (!record) return page("<p>This unsubscribe link is invalid.</p>", 404);
  if (record.used_at) return page("<p>This address is already unsubscribed.</p>");
  const email = escapeHtml(record.email);
  return page(
    `<p>Unsubscribe <strong>${email}</strong> from ORBIT email communications?</p><form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button style="margin-top:16px;padding:10px 16px" type="submit">Unsubscribe</button></form>`,
  );
}

export async function action({ request }: Route.ActionArgs) {
  const url = new URL(request.url);
  const form = url.searchParams.has("token") ? null : await request.formData();
  const token = url.searchParams.get("token") ?? String(form?.get("token") ?? "");
  const result = await unsubscribeByToken(getAppEnv().DB, token);
  if (!result.ok) return page("<p>This unsubscribe link is invalid.</p>", 404);
  return page(`<p>${result.alreadyUnsubscribed ? "This address is already unsubscribed." : `Email communications to ${escapeHtml(result.email)} have been stopped.`}</p>`);
}
