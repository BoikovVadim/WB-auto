import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  // base пути берём из env (envDir = корень монорепо), чтобы один и тот же код
  // собирался и под корень нового домена (sales.oqqi.io → "/"), и под legacy-подпуть
  // старого прода (legendgames.space/wb → VITE_BASE_PATH=/wb/). dev всегда "/".
  const env = loadEnv(mode, "..", "");
  const basePath = command === "serve" ? "/" : env.VITE_BASE_PATH || "/";
  return {
  base: basePath,
  // Read .env from the monorepo root (one level up from Frontend/).
  // Without this Vite only looks in Frontend/ and misses root-level vars
  // like VITE_WB_CLUSTERS_WRITE_API_KEY, which the write-guard requires.
  envDir: "..",
  build: {
    outDir: "build",
    rollupOptions: {
      output: {
        // Vendor-split: библиотеки в отдельные иммутабельные чанки (хешируются, кэшируются
        // браузером надолго и не инвалидируются при правках нашего кода). Чанки секций
        // создаются автоматически из React.lazy(() => import(...)) в WbDashboardShell.
        manualChunks(id: string): string | undefined {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("/scheduler/")) {
            return "react-vendor";
          }
          if (id.includes("@tanstack")) return "virtual-vendor";
          if (id.includes("axios")) return "axios-vendor";
          return "vendor";
        },
      },
    },
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  };
});
