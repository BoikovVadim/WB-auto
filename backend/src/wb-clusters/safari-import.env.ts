import path from "node:path";

import dotenv from "dotenv";
import type { ClientConfig } from "pg";

let envLoaded = false;

function getEnvFiles() {
  return [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), "..", ".env.local"),
  ];
}

export function loadSafariImportEnv() {
  if (envLoaded) {
    return;
  }

  for (const envFile of getEnvFiles()) {
    dotenv.config({ path: envFile, override: true });
  }
  envLoaded = true;
}

export function buildOptionalSafariImportPostgresConfig(): ClientConfig | null {
  loadSafariImportEnv();

  const connectionString = (process.env.DATABASE_URL ?? "").trim();
  if (connectionString) {
    return { connectionString };
  }

  const host = (process.env.PGHOST ?? "").trim();
  const user = (process.env.PGUSER ?? "").trim();
  const database = (process.env.PGDATABASE ?? "").trim();
  if (!host || !user || !database) {
    return null;
  }

  const port = Number.parseInt((process.env.PGPORT ?? "5432").trim(), 10);
  return {
    host,
    user,
    database,
    password: process.env.PGPASSWORD ?? "",
    port: Number.isFinite(port) ? port : 5432,
  };
}

export function buildSafariImportApiBaseUrl() {
  loadSafariImportEnv();

  const explicitBaseUrl = (process.env.WB_CMP_IMPORT_API_BASE_URL ?? "").trim();
  const rawBaseUrl = explicitBaseUrl || "https://legendgames.space/wb/api";
  return rawBaseUrl.replace(/\/+$/, "");
}
