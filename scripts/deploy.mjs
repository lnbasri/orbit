// Build for one named environment and deploy it. Works the same in PowerShell, cmd and bash.
//   npm run deploy:test         (public test Worker on workers.dev)
//   npm run deploy:test-admin   (admin test Worker on workers.dev)
//   node scripts/deploy.mjs <environment>   (any environment defined in wrangler.jsonc)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const name = process.argv[2];

// Parse wrangler.jsonc (strip comments without touching strings).
function parseJsonc(text) {
  let out = "";
  for (let i = 0, inStr = false; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\") out += text[++i];
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out);
}

const config = parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
const envs = Object.keys(config.env ?? {});
if (!name || !envs.includes(name)) {
  console.error(`Usage: node scripts/deploy.mjs <environment>   (defined in wrangler.jsonc: ${envs.join(", ") || "none"})`);
  process.exit(1);
}

const block = JSON.stringify(config.env[name]);
const placeholders = ["00000000-0000-0000-0000-000000000000", "REPLACE_WITH_"].filter((p) => block.includes(p));
if (placeholders.length) {
  console.error(`wrangler.jsonc env.${name} still contains placeholders: ${placeholders.join(", ")}\nFill them in first (see README).`);
  process.exit(1);
}

const env = { ...process.env, CLOUDFLARE_ENV: name };
const run = (cmd, args) => {
  const { status } = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (status !== 0) process.exit(status ?? 1);
};
run("npx", ["react-router", "build"]);
run("npx", ["wrangler", "deploy"]);
