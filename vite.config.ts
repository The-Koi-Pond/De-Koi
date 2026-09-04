import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;
const vendorChunkGroups: Record<string, string[]> = {
  "vendor-react": ["react", "react-dom"],
  "vendor-runtime": ["@tanstack/react-query", "zustand", "zod", "clsx", "tailwind-merge"],
  "vendor-motion": ["framer-motion", "motion"],
  "vendor-dnd": ["@dnd-kit"],
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

const lucideCoreModulePattern =
  /\/node_modules\/lucide-react\/dist\/esm\/(?:shared\/src\/utils|defaultAttributes|Icon|createLucideIcon)\.js$/;
const lucideIconModulePattern = /\/node_modules\/lucide-react\/dist\/esm\/icons\/([^/]+)\.js$/;

function manualVendorChunk(id: string) {
  const normalizedId = id.replace(/\\/g, "/");
  if (!normalizedId.includes("/node_modules/")) return undefined;

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
  plugins: [react(), tailwindcss()],
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
      },
    },
  },
}));
