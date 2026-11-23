import { data } from "react-router";

import type { Route } from "./+types/member-export";
import { adminAccessContext, adminEmailContext } from "~/lib/admin-context";
import { audit } from "~/lib/db.server";
import { getAppEnv } from "~/lib/env.server";
import { hasAdminCapability } from "~/lib/admin-access";
import { exportMembers, membersToCsv, membersToXlsx } from "~/lib/members.server";
import { formatDateTime } from "~/lib/format";

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "export" && intent !== "export-xlsx") {
    return data({ ok: false, message: "Unknown export format." }, { status: 400 });
  }

  const access = context.get(adminAccessContext);
  if (!hasAdminCapability(access, "members.export")) {
    throw data("Access denied. Member export permission is required.", { status: 403 });
  }

  const db = getAppEnv().DB;
  const actor = context.get(adminEmailContext);
  const q = String(form.get("q") ?? "");
  const status = String(form.get("status") ?? "");
  const members = await exportMembers(db, { q, status });
  const stamp = formatDateTime(new Date().toISOString()).replace(/[^0-9]/g, "").slice(0, 14);

  if (intent === "export") {
    const csv = membersToCsv(members);
    await audit(db, actor, "member.export", null, { format: "csv", count: members.length });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="orbit-members-${stamp}.csv"`,
      },
    });
  }

  const xlsx = membersToXlsx(members);
  await audit(db, actor, "member.export", null, { format: "xlsx", count: members.length });
  const body = new ArrayBuffer(xlsx.byteLength);
  new Uint8Array(body).set(xlsx);
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="orbit-members-${stamp}.xlsx"`,
    },
  });
}
