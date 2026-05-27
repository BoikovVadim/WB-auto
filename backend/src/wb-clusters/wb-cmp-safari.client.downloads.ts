import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import AdmZip from "adm-zip";

import type { DownloadedXlsxFile } from "./wb-cmp-safari.client.types";

export function formatIsoDateForRuInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid ISO date for seller-portal export: ${value}`);
  }

  return `${match[3]}.${match[2]}.${match[1]}`;
}

export async function listXlsxFiles(downloadsDirectory: string) {
  const entries = await readdir(downloadsDirectory, { withFileTypes: true });
  const result = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.isFile() || !/\.(xlsx|zip)$/i.test(entry.name)) {
      continue;
    }

    try {
      const fileStats = await stat(join(downloadsDirectory, entry.name));
      result.set(entry.name, fileStats.mtimeMs);
    } catch {
      // Ignore races with Downloads file movement.
    }
  }

  return result;
}

export async function readWorkbookBuffer(absolutePath: string): Promise<Buffer> {
  const raw = await readFile(absolutePath);
  if (!/\.zip$/i.test(absolutePath)) {
    return raw;
  }
  const zip = new AdmZip(raw);
  const xlsxEntry = zip.getEntries().find((e) => /\.xlsx$/i.test(e.entryName));
  if (!xlsxEntry) {
    throw new Error(`No XLSX file found inside ZIP archive: ${absolutePath}`);
  }
  return xlsxEntry.getData();
}

export async function waitForDownloadedXlsxFile(input: {
  downloadsDirectory: string;
  reportName: string;
  downloadHint: string | null;
  startedAtMs: number;
  knownDownloadFiles: Map<string, number>;
  downloadWaitMs: number;
  downloadPollMs: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<DownloadedXlsxFile> {
  const normalizedReportName = normalizeDownloadName(input.reportName);
  const normalizedDownloadHint =
    input.downloadHint !== null ? normalizeDownloadName(input.downloadHint) : null;
  const seenSizes = new Map<string, number>();
  const deadline = Date.now() + input.downloadWaitMs;

  while (Date.now() < deadline) {
    const entries = await readdir(input.downloadsDirectory, { withFileTypes: true });
    const matchingFiles: Array<{
      fileName: string;
      absolutePath: string;
      modifiedAtMs: number;
      size: number;
    }> = [];

    for (const entry of entries) {
      if (!entry.isFile() || !/\.(xlsx|zip)$/i.test(entry.name)) {
        continue;
      }

      const absolutePath = join(input.downloadsDirectory, entry.name);
      let fileStats;

      try {
        fileStats = await stat(absolutePath);
      } catch {
        continue;
      }

      const normalizedFileName = normalizeDownloadName(entry.name);
      const isNewFile =
        !input.knownDownloadFiles.has(entry.name) ||
        (input.knownDownloadFiles.get(entry.name) ?? 0) < fileStats.mtimeMs;
      const matchesReportName = normalizedFileName.includes(normalizedReportName);
      const matchesDownloadHint =
        normalizedDownloadHint !== null &&
        normalizedFileName.includes(normalizedDownloadHint);
      const startedRecently = fileStats.mtimeMs >= input.startedAtMs - 900_000; // accept files from 15 min before run

      if ((isNewFile || startedRecently) && (matchesReportName || matchesDownloadHint)) {
        matchingFiles.push({
          fileName: entry.name,
          absolutePath,
          modifiedAtMs: fileStats.mtimeMs,
          size: fileStats.size,
        });
      }
    }

    matchingFiles.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);

    for (const candidate of matchingFiles) {
      const previousSize = seenSizes.get(candidate.fileName);
      seenSizes.set(candidate.fileName, candidate.size);

      if (candidate.size <= 0 || previousSize !== candidate.size) {
        continue;
      }

      const workbookBuffer = await readWorkbookBuffer(candidate.absolutePath);
      return {
        fileName: candidate.fileName,
        absolutePath: candidate.absolutePath,
        modifiedAt: new Date(candidate.modifiedAtMs).toISOString(),
        workbookBuffer,
      };
    }

    await input.sleep(input.downloadPollMs);
  }

  throw new Error(
    `Seller-portal XLSX download for "${input.reportName}" was not found in ~/Downloads within ${Math.round(
      input.downloadWaitMs / 1000,
    )} seconds.`,
  );
}

function normalizeDownloadName(value: string) {
  // normalize("NFC") converts macOS NFD filenames (е.g. й = U+0438+U+0306)
  // to composed NFC form so Cyrillic includes() comparisons work correctly.
  return value
    .normalize("NFC")
    .toLocaleLowerCase("ru")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}
