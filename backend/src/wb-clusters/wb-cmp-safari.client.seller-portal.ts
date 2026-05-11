import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  formatIsoDateForRuInput,
  listXlsxFiles,
  waitForDownloadedXlsxFile,
} from "./wb-cmp-safari.client.downloads";
import { parseSafariBridgeResponse } from "./wb-cmp-safari.client.response";
import {
  buildSellerPortalExportAppleScript,
  buildSellerPortalHelperScript,
} from "./wb-cmp-safari.client.seller-portal-scripts";

interface RunAppleScriptOptions {
  timeoutMs: number;
  errorContext: string;
}

interface SellerPortalExportFlowDeps {
  downloadWaitMs: number;
  downloadPollMs: number;
  runAppleScript: (
    appleScript: string,
    options: RunAppleScriptOptions,
  ) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
}

export async function exportSellerPortalSearchAnalyticsReport(
  input: {
    periodFrom: string;
    periodTo: string;
    reportName: string;
  },
  deps: SellerPortalExportFlowDeps,
) {
  const downloadsDirectory = join(homedir(), "Downloads");
  await access(downloadsDirectory);

  const startedAtMs = Date.now();
  const knownDownloadFiles = await listXlsxFiles(downloadsDirectory);
  const rawResponse = await deps.runAppleScript(
    buildSellerPortalExportAppleScript({
      helperScript: buildSellerPortalHelperScript(),
      reportName: input.reportName,
      startDateRu: formatIsoDateForRuInput(input.periodFrom),
      endDateRu: formatIsoDateForRuInput(input.periodTo),
    }),
    {
      timeoutMs: 240_000,
      errorContext: "Failed to execute WB seller-portal Safari export",
    },
  );
  const response = parseSafariBridgeResponse(rawResponse);

  if (!response.ok || !response.downloadRequested) {
    throw new Error(
      response.error ??
        "Safari bridge did not confirm seller-portal XLSX download.",
    );
  }

  const downloadedFile = await waitForDownloadedXlsxFile({
    downloadsDirectory,
    reportName: input.reportName,
    downloadHint: response.downloadHint ?? null,
    startedAtMs,
    knownDownloadFiles,
    downloadWaitMs: deps.downloadWaitMs,
    downloadPollMs: deps.downloadPollMs,
    sleep: deps.sleep,
  });

  return {
    downloadedFileName: downloadedFile.fileName,
    downloadedFilePath: downloadedFile.absolutePath,
    downloadedAt: downloadedFile.modifiedAt,
    workbookBuffer: downloadedFile.workbookBuffer,
    warnings: response.warnings ?? [],
  };
}
