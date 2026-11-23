import type { Route } from "./+types/document-download";
import { getApprovedDocument } from "~/lib/documents.server";
import { getAppEnv } from "~/lib/env.server";

export async function loader({ params }: Route.LoaderArgs) {
  const document = await getApprovedDocument(getAppEnv().DB, getAppEnv().DOCUMENTS, params.id);
  if (!document) return new Response("Approved document not found.", { status: 404 });
  const fileName = `${document.title.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "orbit-document"}.pdf`;
  return new Response(document.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
