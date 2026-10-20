// Builds the hosted generation runner (src/runner) into one Node file, dist-runner/runner.mjs.
// It bundles the same engine and runtime-adapter code the web app uses, so the runner image needs only Node.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  ssr: {
    // Bundle every dependency: the runner image ships the bundle without node_modules.
    noExternal: true,
    target: "node",
  },
  build: {
    ssr: "src/runner/main.ts",
    outDir: "dist-runner",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    sourcemap: true,
    rollupOptions: {
      output: { format: "es", entryFileNames: "runner.mjs", inlineDynamicImports: true },
    },
  },
});
