import type { Route } from "./+types/document-download";
import { getApprovedDocument } from "~/lib/documents.server";
import { audit } from "~/lib/db.server";
import { adminEmailContext } from "~/lib/admin-context";
import { getAppEnv } from "~/lib/env.server";

export async function loader({ params, context }: Route.LoaderArgs) {
  const env = getAppEnv();
  const document = await getApprovedDocument(env.DB, env.DOCUMENTS, params.id);
  if (!document) return new Response("Approved document not found.", { status: 404 });
  await audit(env.DB, context.get(adminEmailContext), "document.download", params.id);
  const fileName = `${document.title.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "orbit-document"}.pdf`;
  return new Response(document.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
