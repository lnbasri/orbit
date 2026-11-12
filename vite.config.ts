import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    // Explicit alias (in addition to tsconfig paths) so "~/..." resolves in every build
    // environment, including on Windows where drive-letter casing can differ.
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
    tsconfigPaths: true,
  },
});
