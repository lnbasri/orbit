// Snapshot / compare the DNS records of a domain, to verify a DNS migration (GoDaddy -> Cloudflare). Read-only.
//
//   node scripts/dns-snapshot.mjs save    [domain] [file]            # write a baseline (default ppmedenhaag.nl -> ../docs/dns-baseline.json)
//   node scripts/dns-snapshot.mjs compare [domain] [file]            # re-query, show every difference, run the HTTP smoke checks (exit 1 on any failure)
//
// Options:
//   --server <ns-or-ip>   query this nameserver directly (e.g. one of Cloudflare's assigned nameservers during the
//                         dress rehearsal, step M2). Default: public resolvers 1.1.1.1 + 8.8.8.8 (what the world sees).
//   --no-http             skip the HTTP smoke checks (checkpoint C item 1)
//
// Watched names = what must survive the migration: apex + www/tpa/sholat (Netlify), Google MX/SPF (+ the _spfm include),
// Resend (send MX/TXT, DKIM), subdomain-owner-verification. Deliberately NOT watched: poc/ftp/_vercel (abandoned),
// _dmarc/google._domainkey/CAA (ignored), event/event-admin (created later by the Worker custom domains).
// Names with a CNAME are compared on the CNAME only (a recursive resolver would also return the target's A records,
// an authoritative server would not, and the A records of Netlify's hosts are not ours to compare).
import { readFileSync, writeFileSync } from "node:fs";
import { Resolver } from "node:dns/promises";
import { parseArgs } from "node:util";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { server: { type: "string" }, "no-http": { type: "boolean", default: false } },
});
const [mode = "compare", domain = "ppmedenhaag.nl", file = "../docs/dns-baseline.json"] = positionals;

const labels = [
  "",
  "www",
  "tpa",
  "sholat",
  "send",
  "resend._domainkey",
  "dc-aa8e722993._spfm",
  "subdomain-owner-verification",
];
const types = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"];

const resolver = new Resolver();
if (opts.server) {
  let ip = opts.server;
  if (!/^[\d.:a-f]+$/i.test(ip)) {
    // a nameserver host name: resolve it through the public resolvers first
    const boot = new Resolver();
    boot.setServers(["1.1.1.1", "8.8.8.8"]);
    ip = (await boot.resolve4(opts.server))[0];
  }
  resolver.setServers([ip]);
  console.log(`querying nameserver ${opts.server} (${ip}) directly`);
} else {
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
}

async function lookup(name, type) {
  try {
    const raw = await resolver.resolve(name, type);
    const list = raw.map((r) => {
      if (typeof r === "string") return r.toLowerCase().replace(/\.$/, "");
      if (Array.isArray(r)) return r.join(""); // TXT chunks
      if (r.exchange) return `${r.priority} ${r.exchange.toLowerCase().replace(/\.$/, "")}`;
      return JSON.stringify(r);
    });
    return list.sort();
  } catch (e) {
    if (["ENODATA", "ENOTFOUND", "NODATA", "NXDOMAIN"].includes(e.code)) return [];
    throw e;
  }
}

async function snapshot() {
  const out = {};
  for (const l of labels) {
    const name = l ? `${l}.${domain}` : domain;
    const cname = await lookup(name, "CNAME");
    if (cname.length) (out[name] ??= {}).CNAME = cname;
    for (const t of types) {
      if (t === "CNAME") continue;
      if (cname.length && (t === "A" || t === "AAAA")) continue; // compared via the CNAME
      const v = await lookup(name, t);
      if (v.length) (out[name] ??= {})[t] = v;
    }
  }
  return out;
}

// Checkpoint C, item 1: the Netlify sites still answer 200 from Netlify; the apex still redirects to www.
async function httpChecks() {
  let failed = 0;
  const get = async (url) => {
    try {
      return await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    } catch (e) {
      return { status: 0, headers: new Headers(), error: String(e.cause?.code ?? e.message) };
    }
  };
  for (const host of ["www", "tpa", "sholat"]) {
    const url = `https://${host}.${domain}/`;
    const r = await get(url);
    const server = r.headers.get("server") ?? "";
    const ok = r.status === 200 && /netlify/i.test(server);
    if (!ok) failed++;
    console.log(`${ok ? "OK      " : "FAILED  "} HTTP ${url} -> ${r.status || r.error} Server: ${server || "-"}`);
  }
  const apex = `https://${domain}/`;
  const r = await get(apex);
  const loc = r.headers.get("location") ?? "";
  const ok = [301, 302, 307, 308].includes(r.status) && loc.includes(`www.${domain}`);
  if (!ok) failed++;
  console.log(`${ok ? "OK      " : "FAILED  "} HTTP ${apex} -> ${r.status || r.error} Location: ${loc || "-"}`);
  return failed;
}

const now = await snapshot();
if (mode === "save") {
  writeFileSync(file, JSON.stringify({ domain, takenAt: new Date().toISOString(), records: now }, null, 2) + "\n");
  const n = Object.values(now).reduce((s, r) => s + Object.values(r).reduce((a, v) => a + v.length, 0), 0);
  console.log(`saved ${n} records for ${Object.keys(now).length} names -> ${file}`);
  if (!opts["no-http"]) await httpChecks();
  process.exit(0);
}

const base = JSON.parse(readFileSync(file, "utf8"));
let diffs = 0;
const names = new Set([...Object.keys(base.records), ...Object.keys(now)]);
for (const name of [...names].sort()) {
  for (const t of types) {
    const a = base.records[name]?.[t] ?? [];
    const b = now[name]?.[t] ?? [];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const isNs = t === "NS" && name === domain; // expected to change in a nameserver migration
    if (!isNs) diffs++;
    console.log(`${isNs ? "EXPECTED" : "CHANGED "}  ${name} ${t}`);
    for (const x of a.filter((x) => !b.includes(x))) console.log(`    - ${x}`);
    for (const x of b.filter((x) => !a.includes(x))) console.log(`    + ${x}`);
  }
}
console.log(diffs === 0 ? `DNS OK: identical to baseline of ${base.takenAt} (apex NS ignored)` : `DNS: ${diffs} difference(s) vs baseline of ${base.takenAt}`);
let httpFailed = 0;
if (!opts["no-http"]) httpFailed = await httpChecks();
process.exit(diffs === 0 && httpFailed === 0 ? 0 : 1);
