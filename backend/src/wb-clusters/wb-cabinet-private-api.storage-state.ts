import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { appEnv } from "../common/env";
import type { WbCabinetSessionStatus } from "./wb-clusters.types";

type StorageStateOrigin = {
  origin?: string;
  localStorage?: Array<{ name?: string; value?: string }>;
};

type StorageStateCookie = {
  name?: string;
  value?: string;
  expires?: number;
};

export type PlaywrightStorageState = {
  cookies?: StorageStateCookie[];
  origins?: StorageStateOrigin[];
};

export async function readWbCabinetStorageState() {
  const rawState = await readFile(appEnv.wbCabinetStorageStatePath, "utf8");
  return parseWbCabinetStorageState(rawState);
}

export async function persistWbCabinetStorageState(storageStateJson: string) {
  const parsedState = parseWbCabinetStorageState(storageStateJson);
  const parentDirectory = path.dirname(appEnv.wbCabinetStorageStatePath);
  await mkdir(parentDirectory, { recursive: true });
  await writeFile(
    appEnv.wbCabinetStorageStatePath,
    JSON.stringify(parsedState, null, 2),
    "utf8",
  );
}

export function parseWbCabinetStorageState(rawState: string): PlaywrightStorageState {
  const parsedState = JSON.parse(rawState) as PlaywrightStorageState;
  if (
    !parsedState ||
    typeof parsedState !== "object" ||
    !Array.isArray(parsedState.cookies) ||
    !Array.isArray(parsedState.origins)
  ) {
    throw new Error("Invalid WB cabinet storage state JSON.");
  }

  return parsedState;
}

export function extractSupplierIdFromStorageState(storageState: PlaywrightStorageState) {
  const supplierCookie =
    storageState.cookies?.find((cookie) => cookie.name === "x-supplier-id-external") ?? null;
  return supplierCookie?.value?.trim() ? decodeURIComponent(supplierCookie.value) : null;
}

export function extractSessionExpiryFromStorageState(storageState: PlaywrightStorageState) {
  const expiringCookies =
    storageState.cookies?.filter(
      (cookie) =>
        typeof cookie.expires === "number" &&
        Number.isFinite(cookie.expires) &&
        cookie.expires > 0,
    ) ?? [];
  const nearestExpiry = expiringCookies.reduce<number | null>((current, cookie) => {
    if (typeof cookie.expires !== "number") {
      return current;
    }

    return current === null ? cookie.expires : Math.min(current, cookie.expires);
  }, null);

  return nearestExpiry === null ? null : new Date(nearestExpiry * 1000).toISOString();
}

export function resolveStorageStateSessionStatus(expiresAt: string | null): WbCabinetSessionStatus {
  if (!expiresAt) {
    return "ready";
  }

  return Date.parse(expiresAt) <= Date.now() ? "expired" : "ready";
}
