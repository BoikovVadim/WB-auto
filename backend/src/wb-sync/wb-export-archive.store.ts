import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { appEnv } from "../common/env";
import {
  assertWbExportIntegrity,
  assertWbExportJobIntegrity,
} from "./wb-export.integrity";
import type { WbExportJobResponse, WbExportResponse } from "./wb-sync.types";

export async function ensureWbExportArchiveRoot() {
  const archiveRoot = appEnv.wbArchiveRoot;

  await mkdir(archiveRoot, { recursive: true });

  return archiveRoot;
}

export async function ensureWbExportArchiveMetaRoot() {
  const metaRoot = path.dirname(await ensureWbExportArchiveRoot());

  await mkdir(metaRoot, { recursive: true });

  return metaRoot;
}

export async function createWbExportRawArchiveDirectory(requestId: string) {
  const archiveRoot = await ensureWbExportArchiveRoot();
  const archivePath = path.join(archiveRoot, requestId);

  await mkdir(archivePath, { recursive: true });

  return archivePath;
}

export async function writeWbExportJsonFile(
  archivePath: string,
  fileName: string,
  payload: unknown,
) {
  await writeFile(
    path.join(archivePath, fileName),
    JSON.stringify(payload, null, 2),
    "utf-8",
  );
}

export async function tryReadStoredWbExport(requestId: string) {
  try {
    const archiveRoot = await ensureWbExportArchiveRoot();
    const rawValue = await readFile(
      path.join(archiveRoot, requestId, "result.json"),
      "utf-8",
    );
    const parsed = JSON.parse(rawValue) as WbExportResponse;

    assertWbExportIntegrity(parsed);

    return parsed;
  } catch {
    return null;
  }
}

export async function writeWbExportJobStatus(
  requestId: string,
  payload: WbExportJobResponse,
) {
  const archiveRoot = await ensureWbExportArchiveRoot();
  await writeWbExportJsonFile(path.join(archiveRoot, requestId), "status.json", payload);
}

export async function tryReadStoredWbExportJobStatus(requestId: string) {
  try {
    const archiveRoot = await ensureWbExportArchiveRoot();
    const rawValue = await readFile(
      path.join(archiveRoot, requestId, "status.json"),
      "utf-8",
    );
    const parsed = JSON.parse(rawValue) as WbExportJobResponse;

    assertWbExportJobIntegrity(parsed);

    return parsed;
  } catch {
    return null;
  }
}
