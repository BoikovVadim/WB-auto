import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(function (_a) {
    var command = _a.command;
    return ({
        base: command === "serve" ? "/" : "/wb/",
        // Read .env from the monorepo root (one level up from Frontend/).
        // Without this Vite only looks in Frontend/ and misses root-level vars
        // like VITE_WB_CLUSTERS_WRITE_API_KEY, which the write-guard requires.
        envDir: "..",
        build: {
            outDir: "build",
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
    });
});
