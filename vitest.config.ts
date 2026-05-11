import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "backend/src/**/*.test.ts",
      "Frontend/src/**/*.test.ts",
    ],
    exclude: ["**/dist/**", "**/node_modules/**", "**/build/**"],
  },
});
