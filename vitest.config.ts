import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit + integration tests run in Node. D1 comes from Wrangler's getPlatformProxy (local SQLite),
// so the SQL under test is the same SQL that runs on Cloudflare.
export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
