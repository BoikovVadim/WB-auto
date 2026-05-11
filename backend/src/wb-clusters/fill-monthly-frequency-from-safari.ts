import { randomUUID } from "node:crypto";
import { Client } from "pg";

import {
  buildFreePortalMonthlyFrequencyReportName,
  parseMonthlyFrequencyWorkbookBuffer,
} from "./monthly-frequency-analytics.ingest";
import {
  countMonthlyFrequencySnapshotRows,
  ensureMonthlyFrequencyTable,
  getRequiredMonthlyFrequencyPostgresConfig,
  loadMonthlyFrequencySnapshotSample,
  replaceMonthlyFrequencySnapshot,
} from "./monthly-frequency-import.persistence";
import { getDefaultMonthlyFrequencyImportPeriod } from "./monthly-frequency-import.period";
import { ensureDarwinSafariRuntime } from "./safari-import.runtime";
import { WbCmpSafariClient } from "./wb-cmp-safari.client";

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAdvertisingText(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
}

async function main() {
  ensureDarwinSafariRuntime(
    "This importer must run on macOS because it uses Safari automation.",
  );

  const debugEnabled = process.env.WB_MONTHLY_FREQUENCY_IMPORT_DEBUG === "1";
  const sampleLimit = Number.parseInt(process.env.WB_MONTHLY_FREQUENCY_IMPORT_SAMPLE_LIMIT ?? "10", 10);
  const requestedFrom = (process.env.WB_MONTHLY_FREQUENCY_IMPORT_FROM ?? "").trim();
  const requestedTo = (process.env.WB_MONTHLY_FREQUENCY_IMPORT_TO ?? "").trim();
  const defaultPeriod = getDefaultMonthlyFrequencyImportPeriod();
  const period = {
    from: requestedFrom || defaultPeriod.from,
    to: requestedTo || defaultPeriod.to,
  };
  const reportName =
    (process.env.WB_MONTHLY_FREQUENCY_IMPORT_REPORT_NAME ?? "").trim() ||
    buildFreePortalMonthlyFrequencyReportName({
      from: period.from,
      to: period.to,
      randomSuffix: randomUUID().slice(0, 8),
    });

  const safariClient = new WbCmpSafariClient();
  const client = new Client(getRequiredMonthlyFrequencyPostgresConfig());
  await client.connect();

  try {
    await ensureMonthlyFrequencyTable(client);

    console.log(`Starting free WB monthly frequency import for ${period.from}..${period.to}.`);
    console.log(`Report name: ${reportName}`);

    const downloadedReport = await safariClient.exportFreeSearchAnalyticsReport({
      periodFrom: period.from,
      periodTo: period.to,
      reportName,
    });

    const rows = parseMonthlyFrequencyWorkbookBuffer({
      workbookBuffer: downloadedReport.workbookBuffer,
      readOptionalString,
      normalizeAdvertisingText,
    });
    if (rows.length === 0) {
      throw new Error(
        `WB seller portal report ${reportName} was downloaded, but monthly frequency rows could not be parsed from the XLSX headers.`,
      );
    }

    const rowsUpserted = await replaceMonthlyFrequencySnapshot(client, {
      rows,
      reportType: "FREE_SEARCH_ANALYTICS_PORTAL_XLSX",
      reportId: reportName,
      downloadId: downloadedReport.downloadedFileName,
      period,
      normalizeAdvertisingText,
    });

    const snapshotRows = await countMonthlyFrequencySnapshotRows(client);
    const sample = await loadMonthlyFrequencySnapshotSample(
      client,
      Number.isFinite(sampleLimit) ? sampleLimit : 10,
    );

    console.log(`Rows upserted: ${rowsUpserted}`);
    console.log(`Current snapshot rows: ${snapshotRows}`);
    console.log(`Downloaded file: ${downloadedReport.downloadedFilePath}`);

    if (downloadedReport.warnings?.length) {
      console.log(`Warnings: ${downloadedReport.warnings.join(" | ")}`);
    }

    console.log(`Sample: ${JSON.stringify(sample, null, 2)}`);

    if (debugEnabled) {
      console.log(
        JSON.stringify(
          {
            period,
            reportName,
            downloadedFileName: downloadedReport.downloadedFileName,
            downloadedAt: downloadedReport.downloadedAt,
            parsedRows: rows.length,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
