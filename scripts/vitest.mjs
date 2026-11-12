// Windows: a lowercase drive letter in the cwd (e.g. "c:\" from VS Code) makes Vitest load
// two copies of itself. Re-run from the canonical path so tests work from any terminal.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const cwd = realpathSync.native(process.cwd());
const bin = realpathSync.native(join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs"));
const env = { ...process.env, PWD: cwd, INIT_CWD: cwd };
const { status } = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd, env, stdio: "inherit" });
process.exit(status ?? 1);
