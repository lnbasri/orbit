// Snapshot / compare the PUBLIC DNS records of a domain, to verify a DNS migration (e.g. GoDaddy -> Cloudflare).
// Uses a public resolver (1.1.1.1), so it sees what the world sees. Read-only.
//
//   node scripts/dns-snapshot.mjs save    [domain] [file]   # write a baseline (default ppmedenhaag.nl -> ../docs/dns-baseline.json)
//   node scripts/dns-snapshot.mjs compare [domain] [file]   # re-query and show every difference (exit 1 if any, ignoring NS)
import { readFileSync, writeFileSync } from "node:fs";
import { Resolver } from "node:dns/promises";

const [, , mode = "compare", domain = "ppmedenhaag.nl", file = "../docs/dns-baseline.json"] = process.argv;

// Names worth watching: web (Netlify), company mail (Google), Resend (DKIM, bounce domain), DMARC, the SPF include
// that GoDaddy publishes for this domain, and a few common mail-related hosts. The new event host must stay free.
const labels = [
  "",
  "www",
  "event",
  "_dmarc",
  "send",
  "resend._domainkey",
  "google._domainkey",
  "dc-aa8e722993._spfm",
  "mail",
  "autodiscover",
  "_domainconnect",
];
const types = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "CAA"];

const resolver = new Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

async function lookup(name, type) {
  try {
    const raw = await resolver.resolve(name, type);
    const list = raw.map((r) => {
      if (typeof r === "string") return r.toLowerCase();
      if (Array.isArray(r)) return r.join(""); // TXT chunks
      if (r.exchange) return `${r.priority} ${r.exchange.toLowerCase()}`;
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
    for (const t of types) {
      const v = await lookup(name, t);
      if (v.length) (out[name] ??= {})[t] = v;
    }
  }
  return out;
}

const now = await snapshot();
if (mode === "save") {
  writeFileSync(file, JSON.stringify({ domain, takenAt: new Date().toISOString(), records: now }, null, 2) + "\n");
  const n = Object.values(now).reduce((s, r) => s + Object.values(r).reduce((a, v) => a + v.length, 0), 0);
  console.log(`saved ${n} records for ${Object.keys(now).length} names -> ${file}`);
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
console.log(diffs === 0 ? `OK: identical to baseline of ${base.takenAt} (NS ignored)` : `${diffs} difference(s) vs baseline of ${base.takenAt}`);
process.exit(diffs === 0 ? 0 : 1);
