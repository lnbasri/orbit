import { scannerEnv } from "~/lib/scanner-guard.server";

/**
 * Service worker of the check-in app. Deliberately small:
 *  - precaches the offline page, logo and icons, and caches the app's own static assets on first use (fonts, JS, CSS),
 *    so the app opens quickly on a phone;
 *  - page navigations always go to the network (they carry the session and names), with the offline page as fallback;
 *  - NEVER caches /scan/api/* (names and check-in data), and never anything cross-origin or non-GET.
 * Check-in itself is online-only (decision 14 Nov 2026).
 */
const SW = `
const VERSION = "v1";
const SHELL = "ppme-scan-shell-" + VERSION;
const RUNTIME = "ppme-scan-runtime-" + VERSION;
const PRECACHE = ["/scan/offline", "/logo-ppme.png", "/scan-icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ppme-scan-") && k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/scan/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/scan/offline")));
    return;
  }

  const isStatic = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/scan-icons/") || url.pathname === "/logo-ppme.png";
  if (!isStatic) return;
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); }
        return res;
      });
    })
  );
});
`;

export function loader() {
  scannerEnv();
  return new Response(SW, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/scan",
    },
  });
}
