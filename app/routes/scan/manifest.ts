import { scannerEnv } from "~/lib/scanner-guard.server";

/** Web app manifest of the check-in app (installable on iPhone and Android). Scope = /scan only. */
export function loader() {
  scannerEnv();
  const manifest = {
    name: "PPME Check-in",
    short_name: "Check-in",
    description: "Check-in Kajian PPME Den Haag",
    id: "/scan",
    start_url: "/scan",
    scope: "/scan",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#034ea2",
    lang: "id",
    icons: [
      { src: "/scan-icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/scan-icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/scan-icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
