import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// Source modules every home screen load needs. The bundle budget measures the chunks that hold them, looked up by
// module, because merging small chunks (experimentalMinChunkSize below) can rename the chunk a module lands in.
const homeScreenModules = ["src/app/AppExperience.tsx", "src/features/modes/router/components/ModeSurface.tsx"];

function homeScreenChunks(): Plugin {
  return {
    name: "de-koi-home-screen-chunks",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((output) => output.type === "chunk");
      const files = Object.fromEntries(
        homeScreenModules.map((module) => [
          module,
          chunks.find((chunk) => chunk.moduleIds.some((id) => id.replace(/\\/g, "/").endsWith(`/${module}`)))
            ?.fileName ?? null,
        ]),
      );
      this.emitFile({ type: "asset", fileName: ".vite/home-chunks.json", source: JSON.stringify(files, null, 2) });
    },
  };
}
const vendorChunkGroups: Record<string, string[]> = {
  "vendor-react": ["react", "react-dom"],
  "vendor-runtime": ["@tanstack/react-query", "zustand", "clsx", "tailwind-merge"],
  // Off the home screen: only settings writes and engine code validate with zod.
  "vendor-zod": ["zod"],
  "vendor-sanitize": ["dompurify"],
  "vendor-notifications": ["sonner"],
  "vendor-tauri": [
    "@tauri-apps/api",
    "@tauri-apps/plugin-dialog",
    "@tauri-apps/plugin-notification",
    "@tauri-apps/plugin-opener",
  ],
};

// Coalesce icons shared by deferred Roleplay/setup surfaces without pulling
// every lazy feature's icons into the normal AppExperience load path.
const roleplaySharedLucideIcons = new Set([
  "check",
  "chevron-left",
  "circle-alert",
  "copy",
  "download",
  "ellipsis",
  "external-link",
  "eye",
  "eye-off",
  "folder",
  "globe",
  "message-circle",
  "pause",
  "play",
  "refresh-cw",
  "rotate-ccw",
  "send",
  "volume-2",
  "wand-sparkles",
  "zap",
]);

// The Tauri window module (and the helpers only it uses) loads on first use from
// window-controls-api.ts; grouped into vendor-tauri it would be back in the home load.
const lazyTauriApiModulePattern = /\/node_modules\/@tauri-apps\/api\/(?:window|dpi|image|event)\.js$/;

const lucideCoreModulePattern =
  /\/node_modules\/lucide-react\/dist\/esm\/(?:shared\/src\/utils|defaultAttributes|Icon|createLucideIcon)\.js$/;
const lucideIconModulePattern = /\/node_modules\/lucide-react\/dist\/esm\/icons\/([^/]+)\.js$/;

function manualVendorChunk(id: string) {
  const normalizedId = id.replace(/\\/g, "/");
  if (!normalizedId.includes("/node_modules/")) return undefined;
  if (lazyTauriApiModulePattern.test(normalizedId)) return undefined;

  if (lucideCoreModulePattern.test(normalizedId)) return "vendor-icons-core";

  const lucideIconModule = normalizedId.match(lucideIconModulePattern);
  if (lucideIconModule && roleplaySharedLucideIcons.has(lucideIconModule[1])) {
    return "vendor-icons-roleplay";
  }

  for (const [chunkName, packages] of Object.entries(vendorChunkGroups)) {
    if (packages.some((packageName) => normalizedId.includes(`/node_modules/${packageName}/`))) {
      return chunkName;
    }
  }

  return undefined;
}

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), homeScreenChunks()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    manifest: true,
    minify: "terser" as const,
    // The largest remaining JS chunk is lazy Game mode route code; keep
    // startup/vendor leakage visible while allowing that intentional split.
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: manualVendorChunk,
        // About 120 of 260 chunks were under 1 KiB gzip, each paying its own gzip and import overhead. Rollup merges
        // chunks under 4 KB into a chunk they already load with, only where no entry's side effects change. Measured
        // totalJs -20 KiB, homeJs +5.6 KiB; 8000 saved 7.6 KiB more in total but added 4.3 KiB more to the home load.
        experimentalMinChunkSize: 4000,
      },
    },
  },
}));
