import { data } from "react-router";

import type { Route } from "./+types/export";
import { adminEmailContext } from "~/lib/admin-context";
import { exportRows, type RegistrationFilters } from "~/lib/admin.server";
import { toCsv } from "~/lib/csv";
import { audit, getEventBySlug } from "~/lib/db.server";
import { getAppEnv } from "~/lib/env.server";
import { exportRowsToIndonesian } from "~/lib/format";

// Resource route (no UI): GET /admin/export?status=…&member=…  → CSV, one row per participant.
export async function loader({ url, context }: Route.LoaderArgs) {
  const env = getAppEnv();
  const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
  if (!event) throw data("Acara tidak ditemukan.", { status: 404 });
  const p = url.searchParams;
  const filters: RegistrationFilters = {
    q: p.get("q") ?? "",
    email: p.get("email") ?? "",
    status: p.get("status") ?? "",
    member: (p.get("member") ?? "") as RegistrationFilters["member"],
    source: (p.get("source") ?? "") as RegistrationFilters["source"],
  };
  const rows = await exportRows(env.DB, event, filters);
  await audit(env.DB, context.get(adminEmailContext), "export.csv", null, { filters, rows: rows.length });

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const csv = exportRowsToIndonesian(rows);
  return new Response(toCsv(csv.rows, csv.columns), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.slug}-peserta-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
