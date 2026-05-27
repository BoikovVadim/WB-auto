/**
 * Download WB search analytics report via seller-content API + Safari browser download.
 *
 * Flow:
 *   1. Verify WB portal tab is open and API is reachable (GET reports list)
 *   2. Create report via POST (async XHR injected into the tab)
 *   3. Poll GET list until status = SUCCESS
 *   4. Trigger anchor-click download (uses browser's httpOnly session cookies)
 *   5. Wait for XLSX/ZIP file to appear in ~/Downloads
 *   6. Parse XLSX rows and upsert to PostgreSQL
 *
 * Prerequisites:
 *   - macOS (Darwin)
 *   - Safari open with seller.wildberries.ru logged in (FRESH session required for download)
 *   - SSH tunnel or direct access to production PostgreSQL
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register \
 *     backend/src/wb-clusters/fill-monthly-frequency-from-api.ts
 *
 * Optional env vars:
 *   WB_MONTHLY_FREQUENCY_IMPORT_FROM  (ISO date, default: 30-day rolling window)
 *   WB_MONTHLY_FREQUENCY_IMPORT_TO    (ISO date)
 */

import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
import { executeAppleScript } from "./wb-cmp-safari.client.apple-script";
import { listXlsxFiles, waitForDownloadedXlsxFile } from "./wb-cmp-safari.client.downloads";
import {
  buildAsyncXhrAppleScript,
  buildCreateReportBody,
  buildDownloadTriggerAppleScript,
  buildListUrl,
  ContentAnalyticsDownloadEntry,
  ContentAnalyticsListResponse,
  ContentAnalyticsReportType,
  generateReportId,
  parseXhrResult,
  WB_CONTENT_ANALYTICS_CREATE_URL,
} from "./wb-content-analytics-api.client";

const REPORT_TYPE: ContentAnalyticsReportType = "SEARCH_ANALYSIS_PREMIUM_REPORT";
const POLL_INTERVAL_MS = 8_000;
const POLL_TIMEOUT_MS = 12 * 60 * 1_000; // 12 minutes
const DOWNLOAD_WAIT_MS = 5 * 60 * 1_000; // 5 minutes
const DOWNLOAD_POLL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAdvertisingText(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
}

async function runAppleScript(script: string, timeoutMs: number): Promise<string> {
  return executeAppleScript(script, {
    timeoutMs,
    errorContext: "WB Content Analytics API",
    onStderr: (msg) => console.warn("[osascript]", msg),
  });
}

async function apiGet(url: string): Promise<{ status: number; body: string; error: string | null }> {
  const script = buildAsyncXhrAppleScript({ method: "GET", url, pollSeconds: 30 });
  const raw = await runAppleScript(script, 45_000);
  return parseXhrResult(raw);
}

async function apiPost(url: string, body: string): Promise<{ status: number; body: string; error: string | null }> {
  const script = buildAsyncXhrAppleScript({ method: "POST", url, body, pollSeconds: 20 });
  const raw = await runAppleScript(script, 35_000);
  return parseXhrResult(raw);
}

async function verifyPortalAccess(): Promise<void> {
  console.log("Verifying seller portal API access...");
  const result = await apiGet(buildListUrl(REPORT_TYPE));
  if (result.error || result.status !== 200) {
    throw new Error(
      `Cannot reach seller-content API (status=${result.status}, error=${result.error ?? "none"}). ` +
      `Make sure Safari has seller.wildberries.ru open and you are freshly logged in.`,
    );
  }
  console.log("Portal API access verified.");
}

async function createReport(reportId: string): Promise<void> {
  console.log(`Creating report ${reportId}...`);
  const body = buildCreateReportBody({ reportId, reportType: REPORT_TYPE });
  const result = await apiPost(WB_CONTENT_ANALYTICS_CREATE_URL, body);

  if (result.error) {
    throw new Error(`Failed to create report: ${result.error}`);
  }
  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`Create report returned HTTP ${result.status}: ${result.body.slice(0, 300)}`);
  }
  console.log(`Report created successfully (HTTP ${result.status}).`);
}

async function pollUntilReady(reportId: string): Promise<ContentAnalyticsDownloadEntry> {
  const listUrl = buildListUrl(REPORT_TYPE);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    const result = await apiGet(listUrl);

    if (result.error || result.status !== 200) {
      console.warn(`Poll attempt ${attempt} failed (status=${result.status}). Retrying...`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    let parsed: ContentAnalyticsListResponse;
    try {
      parsed = JSON.parse(result.body) as ContentAnalyticsListResponse;
    } catch {
      console.warn("Failed to parse poll response. Retrying...");
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (parsed.error || !parsed.data) {
      console.warn(`API error: ${parsed.errorText}. Retrying...`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const entry = parsed.data.downloads.find((d) => d.id === reportId);
    if (!entry) {
      console.log(`[Poll ${attempt}] Report not in list yet...`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    console.log(`[Poll ${attempt}] Report status: ${entry.status}`);

    if (entry.status === "SUCCESS") return entry;
    if (entry.status === "FAILED") {
      throw new Error(`Report ${reportId} generation failed on WB servers.`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Report ${reportId} did not reach SUCCESS within ${Math.round(POLL_TIMEOUT_MS / 60_000)} minutes.`,
  );
}

async function triggerDownload(downloadUrl: string): Promise<void> {
  console.log(`Triggering download: ${downloadUrl}`);
  const script = buildDownloadTriggerAppleScript(downloadUrl);
  const result = await runAppleScript(script, 15_000);
  console.log(`Download trigger result: ${result}`);
}

async function main() {
  ensureDarwinSafariRuntime(
    "This importer must run on macOS because it uses Safari automation.",
  );

  const defaultPeriod = getDefaultMonthlyFrequencyImportPeriod();
  const period = {
    from: (process.env.WB_MONTHLY_FREQUENCY_IMPORT_FROM ?? "").trim() || defaultPeriod.from,
    to: (process.env.WB_MONTHLY_FREQUENCY_IMPORT_TO ?? "").trim() || defaultPeriod.to,
  };

  const reportId = generateReportId();
  const reportName = buildFreePortalMonthlyFrequencyReportName({
    from: period.from,
    to: period.to,
    randomSuffix: randomUUID().slice(0, 8),
  });

  const downloadsDirectory = join(homedir(), "Downloads");
  await access(downloadsDirectory);

  console.log(`=== WB Monthly Frequency Import via API ===`);
  console.log(`Period: ${period.from} → ${period.to}`);
  console.log(`Report ID: ${reportId}`);

  // Step 1: Verify API access
  await verifyPortalAccess();

  // Step 2: Snapshot existing downloads, create report
  const knownDownloadFiles = await listXlsxFiles(downloadsDirectory);
  const startedAtMs = Date.now();

  await createReport(reportId);

  // Step 3: Poll until report is ready (WB generates in ~60s for 300k rows)
  console.log("Polling for report readiness...");
  const entry = await pollUntilReady(reportId);
  console.log(`Report ready! Size: ${entry.size} bytes (${Math.round(entry.size / 1024 / 1024)} MB)`);

  // Step 4: Trigger download (requires valid httpOnly session cookies on downloads-content-analytics.wildberries.ru)
  await triggerDownload(entry.downloadUrl);

  // Step 5: Wait for file in ~/Downloads
  console.log(`Waiting for file in ~/Downloads (timeout: ${DOWNLOAD_WAIT_MS / 60_000} min)...`);
  const downloadedFile = await waitForDownloadedXlsxFile({
    downloadsDirectory,
    reportName,
    downloadHint: "поисковые запросы",
    startedAtMs,
    knownDownloadFiles,
    downloadWaitMs: DOWNLOAD_WAIT_MS,
    downloadPollMs: DOWNLOAD_POLL_MS,
    sleep,
  });
  console.log(`File downloaded: ${downloadedFile.fileName}`);

  // Step 6: Parse XLSX
  const rows = parseMonthlyFrequencyWorkbookBuffer({
    workbookBuffer: downloadedFile.workbookBuffer,
    readOptionalString,
    normalizeAdvertisingText,
  });

  if (rows.length === 0) {
    throw new Error(
      `Could not parse rows from ${downloadedFile.fileName}. ` +
      `To import manually: npx ts-node ... fill-monthly-frequency-from-local-file.ts ` +
      `--file="${downloadedFile.absolutePath}" --from="${period.from}" --to="${period.to}"`,
    );
  }

  console.log(`Parsed ${rows.length} rows.`);

  // Step 7: Import to PostgreSQL
  console.log("Connecting to PostgreSQL...");
  const client = new Client(getRequiredMonthlyFrequencyPostgresConfig());
  await client.connect();

  try {
    await ensureMonthlyFrequencyTable(client);

    const rowsUpserted = await replaceMonthlyFrequencySnapshot(client, {
      rows,
      reportType: "FREE_SEARCH_ANALYTICS_PORTAL_XLSX",
      reportId,
      downloadId: downloadedFile.fileName,
      period,
      normalizeAdvertisingText,
    });

    const snapshotRows = await countMonthlyFrequencySnapshotRows(client);
    const sample = await loadMonthlyFrequencySnapshotSample(client, 10);

    console.log(`\n=== Import Complete ===`);
    console.log(`Rows upserted: ${rowsUpserted}`);
    console.log(`Total snapshot rows: ${snapshotRows}`);
    console.log(`Sample:\n${JSON.stringify(sample, null, 2)}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
