/**
 * Download WB search analytics reports category by category and import to PostgreSQL.
 *
 * Flow per category:
 *   Pass 1: subjectIDs=[all subjects in category], orderBy=frequency DESC, limit=300k
 *   If pass 1 returned exactly 300k rows → data may be truncated →
 *   Pass 2: same subjectIDs, orderBy=frequency ASC, limit=300k
 *   Merge passes 1+2: deduplicate by normalizedQueryIdentity, keep max frequency.
 *
 * After all categories: accumulate all rows, deduplicate globally, one final DB replace.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register \
 *     backend/src/wb-clusters/fill-monthly-frequency-by-category.ts
 *
 *   # Optional: restrict to specific categories (comma-separated):
 *   CATEGORY_FILTER="Мебель корпусная и мебель для хранения,Товары для животных" \
 *     npx ts-node -r tsconfig-paths/register \
 *     backend/src/wb-clusters/fill-monthly-frequency-by-category.ts
 *
 * Requires a fresh WB seller portal session open in Safari.
 */

import { access, writeFile as fsWriteFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";

import {
  parseMonthlyFrequencyWorkbookBuffer,
} from "./monthly-frequency-analytics.ingest";
import type { MonthlyFrequencyRow } from "./monthly-frequency-analytics.types";
import {
  ensureMonthlyFrequencyTable,
  getRequiredMonthlyFrequencyPostgresConfig,
  replaceMonthlyFrequencySnapshot,
} from "./monthly-frequency-import.persistence";
import { getDefaultMonthlyFrequencyImportPeriod } from "./monthly-frequency-import.period";
import {
  buildSafariImportApiBaseUrl,
  loadSafariImportEnv,
} from "./safari-import.env";
import { ensureDarwinSafariRuntime } from "./safari-import.runtime";
import { executeAppleScript } from "./wb-cmp-safari.client.apple-script";
import { listXlsxFiles, waitForDownloadedXlsxFile } from "./wb-cmp-safari.client.downloads";
import {
  buildAsyncXhrAppleScript,
  buildCreateReportBody,
  buildListUrl,
  type ContentAnalyticsDownloadEntry,
  type ContentAnalyticsListResponse,
  type ContentAnalyticsReportType,
  generateReportId,
  parseXhrResult,
  WB_CONTENT_ANALYTICS_CREATE_URL,
} from "./wb-content-analytics-api.client";

const REPORT_TYPE: ContentAnalyticsReportType = "SEARCH_ANALYSIS_PREMIUM_REPORT";
const POLL_INTERVAL_MS = 8_000;
const POLL_TIMEOUT_MS = 12 * 60 * 1_000;
const DOWNLOAD_WAIT_MS = 5 * 60 * 1_000;
const DOWNLOAD_POLL_MS = 2_000;
const MAX_ROWS = 300_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAdvertisingText(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
}

function normalizeQueryIdentity(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/[_/\\|.,:;!?()[\]{}"'+=*%#№@`~^&-]+/g, " ")
    .replace(/\s+/g, " ");
}

async function runAppleScript(script: string, timeoutMs: number): Promise<string> {
  return executeAppleScript(script, {
    timeoutMs,
    errorContext: "WB Analytics Category Download",
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

async function listExistingReports(): Promise<ContentAnalyticsDownloadEntry[]> {
  const result = await apiGet(buildListUrl(REPORT_TYPE));
  if (result.error || result.status !== 200) return [];
  try {
    const parsed = JSON.parse(result.body) as ContentAnalyticsListResponse;
    return parsed.data?.downloads ?? [];
  } catch {
    return [];
  }
}

async function createAndPollReport(
  reportId: string,
  subjectIds: number[],
  orderByMode: "asc" | "desc",
  label: string,
): Promise<ContentAnalyticsDownloadEntry> {
  const body = buildCreateReportBody({
    reportId,
    reportType: REPORT_TYPE,
    subjectIds,
    orderByMode,
  });
  const createResult = await apiPost(WB_CONTENT_ANALYTICS_CREATE_URL, body);
  if (createResult.error || (createResult.status !== 200 && createResult.status !== 201)) {
    throw new Error(
      `Failed to create ${label} (HTTP ${createResult.status}): ${createResult.body.slice(0, 200)}`,
    );
  }
  console.log(`  ${label} created (HTTP ${createResult.status}). Polling for readiness...`);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const list = await listExistingReports();
    const entry = list.find((e) => e.id === reportId);
    if (!entry) { console.log("  Report not in list yet..."); continue; }
    console.log(`  Report status: ${entry.status}`);
    if (entry.status === "SUCCESS") return entry;
    if (entry.status === "FAILED") throw new Error(`Report ${reportId} generation failed on WB servers.`);
  }
  throw new Error(`Report did not become ready within ${POLL_TIMEOUT_MS / 60_000} minutes.`);
}

/**
 * Click the newest SUCCESS "Скачать" button in the WB Downloads Manager panel.
 * This uses the portal's own download handler with full httpOnly cookie auth —
 * the same approach that works in fill-monthly-frequency-download-and-import.ts.
 */
async function triggerDownloadNewestSuccessReport(): Promise<void> {
  // Click the first SUCCESS chip — the newest created report is always at the top.
  const jsClick = `(function(){
    window.__dlNewestResult = null;
    function getPanel(){return document.querySelector('[class*=Download-manager-wrapper__downloads-wrapper]');}
    function openPanel(cb){
      var w=document.querySelector('[class*=Download-manager-wrapper]');
      if(!w){window.__dlNewestResult=JSON.stringify({s:'no-wrapper'});return;}
      var b=w.querySelector('button');
      if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      setTimeout(cb,600);
    }
    function tryClick(panel){
      if(!panel)return{s:'no-panel'};
      if(panel.querySelector('[class*=skeleton]'))return{s:'loading'};
      var rows=Array.from(panel.querySelectorAll('[class*=File-row__G]'));
      for(var i=0;i<rows.length;i++){
        var chip=rows[i].querySelector('[data-testid=File-row-SUCCESS-chips-component]');
        if(!chip)continue;
        chip.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        return{s:'ok',row:(rows[i].innerText||'').substring(0,80)};
      }
      return{s:'no-row',count:rows.length};
    }
    var attempts=0;
    function poll(){
      attempts++;
      var p=getPanel();
      var r=tryClick(p);
      if(r.s==='ok'||r.s==='no-panel'||r.s==='no-wrapper'||attempts>=80){
        window.__dlNewestResult=JSON.stringify(r);
      } else {
        setTimeout(poll,500);
      }
    }
    openPanel(function(){
      openPanel(function(){
        setTimeout(poll,300);
      });
    });
  })();`;

  const jsTmpPath = "/tmp/wb-dl-newest-inject.js";
  await fsWriteFile(jsTmpPath, jsClick, "utf8");

  const appleScript = `tell application "Safari"
  set myTab to null
  repeat with w in windows
    repeat with tr in tabs of w
      try
        if URL of tr contains "seller.wildberries.ru" then
          set myTab to tr
          exit repeat
        end if
      on error
      end try
    end repeat
    if myTab is not null then exit repeat
  end repeat
  if myTab is null then
    set myTab to (make new document with properties {URL:"https://seller.wildberries.ru/search-analytics/popular-search-queries"})
    delay 12
  end if
  if URL of myTab does not contain "search-analytics" then
    set URL of myTab to "https://seller.wildberries.ru/search-analytics/popular-search-queries"
    delay 9
  end if
  delay 2
  set dlCode to (read POSIX file "/tmp/wb-dl-newest-inject.js" as «class utf8»)
  do JavaScript dlCode in myTab
  set dlResult to "timeout"
  repeat 90 times
    delay 0.5
    try
      set v to do JavaScript "(function(){var v=window.__dlNewestResult;return typeof v==='string'?v:null;})()" in myTab
      if v is not missing value and v is not "" and v is not "null" then
        set dlResult to v
        exit repeat
      end if
    on error
    end try
  end repeat
  return dlResult
end tell`;

  const raw = await runAppleScript(appleScript, 90_000);
  console.log(`  Downloads panel: ${raw}`);

  if (raw === "timeout") throw new Error("Downloads panel timed out. Make sure Safari is open at seller.wildberries.ru");
  type PanelResult = { s: string; row?: string; count?: number };
  let result: PanelResult;
  try { result = JSON.parse(raw) as PanelResult; } catch { throw new Error(`Unexpected panel result: ${raw}`); }
  if (result.s !== "ok") {
    throw new Error(`Downloads panel failed (${JSON.stringify(result)}). Open Safari at seller.wildberries.ru`);
  }
  console.log(`  Clicked: ${result.row ?? "(unknown)"}`);
}

async function downloadReport(
  _entry: ContentAnalyticsDownloadEntry,
  downloadsDirectory: string,
  startedAtMs: number,
  knownFiles: Map<string, number>,
): Promise<MonthlyFrequencyRow[]> {
  await triggerDownloadNewestSuccessReport();

  const downloadedFile = await waitForDownloadedXlsxFile({
    downloadsDirectory,
    reportName: "поисковые запросы",
    downloadHint: "поисковые",
    startedAtMs,
    knownDownloadFiles: knownFiles,
    downloadWaitMs: DOWNLOAD_WAIT_MS,
    downloadPollMs: DOWNLOAD_POLL_MS,
    sleep,
  });

  console.log(`  File: ${downloadedFile.fileName} (${Math.round(downloadedFile.workbookBuffer.length / 1024)}KB)`);

  const rows = parseMonthlyFrequencyWorkbookBuffer({
    workbookBuffer: downloadedFile.workbookBuffer,
    readOptionalString,
    normalizeAdvertisingText,
  });

  // Add downloaded file to known set so next download detection starts fresh
  knownFiles.set(downloadedFile.absolutePath, Date.now());
  return rows;
}

/**
 * Download one category (with optional 2-pass for >300k).
 * Returns deduplicated rows for this category.
 */
async function downloadCategory(
  categoryName: string,
  subjectIds: number[],
  downloadsDirectory: string,
): Promise<MonthlyFrequencyRow[]> {
  const knownFiles = await listXlsxFiles(downloadsDirectory);

  // Pass 1: DESC (highest frequency first)
  console.log(`  [Pass 1 DESC] Creating report for ${subjectIds.length} subjects...`);
  const reportId1 = generateReportId();
  const startMs1 = Date.now();
  const entry1 = await createAndPollReport(
    reportId1,
    subjectIds,
    "desc",
    `"${categoryName}" pass-1 desc`,
  );
  const rows1 = await downloadReport(entry1, downloadsDirectory, startMs1, knownFiles);
  console.log(`  [Pass 1] Got ${rows1.length} rows.`);

  if (rows1.length < MAX_ROWS) {
    // Full data fits in one pass — no second pass needed
    return rows1;
  }

  // Pass 2: ASC (lowest frequency first) — captures the tail that DESC truncated
  console.log(`  [Pass 2 ASC] Exactly ${MAX_ROWS} rows — possible truncation, fetching ascending...`);
  const reportId2 = generateReportId();
  const startMs2 = Date.now();
  const entry2 = await createAndPollReport(
    reportId2,
    subjectIds,
    "asc",
    `"${categoryName}" pass-2 asc`,
  );
  const rows2 = await downloadReport(entry2, downloadsDirectory, startMs2, knownFiles);
  console.log(`  [Pass 2] Got ${rows2.length} rows.`);

  // Merge: deduplicate by normalizedQueryIdentity, keep max frequency
  const merged = new Map<string, MonthlyFrequencyRow>();
  for (const row of [...rows1, ...rows2]) {
    const key = normalizeQueryIdentity(row.queryText);
    const existing = merged.get(key);
    if (!existing || row.monthlyFrequency > existing.monthlyFrequency) {
      merged.set(key, row);
    }
  }

  const mergedRows = Array.from(merged.values());
  console.log(`  [Merged] ${rows1.length} + ${rows2.length} → ${mergedRows.length} unique rows.`);
  return mergedRows;
}

async function loadSubjectIdsByCategoryFromDb(client: Client): Promise<Map<string, number[]>> {
  const result = await client.query<{ category_name: string; subject_id: string }>(
    `SELECT DISTINCT category_name, subject_id::text AS subject_id
     FROM public.wb_product_catalog
     WHERE category_name IS NOT NULL AND subject_id IS NOT NULL
     ORDER BY category_name`,
  );
  const map = new Map<string, number[]>();
  for (const row of result.rows) {
    const id = Number(row.subject_id);
    if (!Number.isFinite(id)) continue;
    const existing = map.get(row.category_name) ?? [];
    existing.push(id);
    map.set(row.category_name, existing);
  }
  return map;
}

async function notifyFrequencyCacheBust(): Promise<void> {
  loadSafariImportEnv();
  const baseUrl = buildSafariImportApiBaseUrl();
  const url = `${baseUrl}/wb-clusters/sync/frequency-cache-bust`;
  const writeKey = (process.env.WB_CLUSTERS_WRITE_API_KEY ?? "").trim();
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-wb-write-intent": "dashboard",
    };
    if (writeKey) headers["x-wb-write-key"] = writeKey;
    const res = await fetch(url, { method: "POST", headers });
    if (res.ok) {
      const body = await res.json() as { clearedAt?: string };
      console.log(`\nServer caches cleared at ${body.clearedAt ?? "unknown"}. Frequency data is live immediately.`);
    } else {
      console.warn(`\nCache-bust returned ${res.status}. Caches will expire by TTL.`);
    }
  } catch (err) {
    console.warn(`\nCould not reach server for cache-bust (${(err as Error).message}). Data will appear after TTL.`);
  }
}

async function main() {
  ensureDarwinSafariRuntime(
    "This script must run on macOS because it uses Safari automation.",
  );

  const defaultPeriod = getDefaultMonthlyFrequencyImportPeriod();
  const period = {
    from: (process.env.WB_MONTHLY_FREQUENCY_IMPORT_FROM ?? "").trim() || defaultPeriod.from,
    to: (process.env.WB_MONTHLY_FREQUENCY_IMPORT_TO ?? "").trim() || defaultPeriod.to,
  };

  // Optional comma-separated category filter
  const categoryFilter = (process.env.CATEGORY_FILTER ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const downloadsDirectory = join(homedir(), "Downloads");
  await access(downloadsDirectory);

  console.log(`=== WB Monthly Frequency Download by Category ===`);
  console.log(`Target period: ${period.from} → ${period.to}`);

  // Step 0: Connect to DB, load category → subjectIDs mapping
  const client = new Client(getRequiredMonthlyFrequencyPostgresConfig());
  await client.connect();

  let categoryMap: Map<string, number[]>;
  try {
    await ensureMonthlyFrequencyTable(client);
    categoryMap = await loadSubjectIdsByCategoryFromDb(client);
  } finally {
    await client.end();
  }

  if (categoryMap.size === 0) {
    console.error(
      "No categories with subject_id found in wb_product_catalog.\n" +
      "Run the server first so syncCategoryNames() populates subject_id, then retry.",
    );
    process.exitCode = 1;
    return;
  }

  // Apply optional category filter
  let categories = Array.from(categoryMap.entries());
  if (categoryFilter.length > 0) {
    categories = categories.filter(([name]) => categoryFilter.includes(name));
    if (categories.length === 0) {
      console.error(`No categories matched CATEGORY_FILTER: ${categoryFilter.join(", ")}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\nCategories to download: ${categories.length}`);
  for (const [name, ids] of categories) {
    console.log(`  • ${name} (${ids.length} subjects, IDs: [${ids.slice(0, 5).join(",")}${ids.length > 5 ? "..." : ""}])`);
  }
  console.log("");

  // Step 1: Download each category, accumulate all rows
  // Global dedup map: normalizedQueryIdentity → row with max frequency
  const globalRows = new Map<string, MonthlyFrequencyRow>();
  const stats: Array<{ category: string; rows: number; passes: number }> = [];

  for (const [categoryName, subjectIds] of categories) {
    console.log(`\n[${categoryName}] subjectIDs: [${subjectIds.join(",")}]`);
    try {
      const rows = await downloadCategory(categoryName, subjectIds, downloadsDirectory);
      const passes = rows.length > 0 ? (rows.length === MAX_ROWS ? 2 : 1) : 1;

      for (const row of rows) {
        const key = normalizeQueryIdentity(row.queryText);
        const existing = globalRows.get(key);
        if (!existing || row.monthlyFrequency > existing.monthlyFrequency) {
          globalRows.set(key, row);
        }
      }

      stats.push({ category: categoryName, rows: rows.length, passes });
      console.log(`  ✓ ${categoryName}: ${rows.length} rows added to accumulator (global total: ${globalRows.size})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${categoryName}: FAILED — ${msg}`);
      stats.push({ category: categoryName, rows: 0, passes: 0 });
    }
  }

  if (globalRows.size === 0) {
    console.error("\nNo rows collected across all categories. Nothing imported.");
    process.exitCode = 1;
    return;
  }

  // Step 2: One final DB replace with all accumulated rows
  console.log(`\n=== Importing ${globalRows.size} unique rows to DB ===`);
  const importClient = new Client(getRequiredMonthlyFrequencyPostgresConfig());
  await importClient.connect();
  try {
    const rowsUpserted = await replaceMonthlyFrequencySnapshot(importClient, {
      rows: Array.from(globalRows.values()),
      reportType: "SEARCH_ANALYSIS_PREMIUM_REPORT_BY_CATEGORY",
      reportId: `by-category-${period.from}-${period.to}`,
      downloadId: `by-category-${period.from}-${period.to}`,
      period,
      normalizeAdvertisingText,
    });

    console.log(`\n=== Done ===`);
    console.log(`Rows upserted: ${rowsUpserted}`);
    console.log(`\nPer-category summary:`);
    for (const s of stats) {
      const passLabel = s.passes === 2 ? " (2 passes)" : "";
      console.log(`  ${s.rows > 0 ? "✓" : "✗"} ${s.category}: ${s.rows} rows${passLabel}`);
    }
  } finally {
    await importClient.end();
  }

  // Step 3: Bust server caches so data is visible immediately
  await notifyFrequencyCacheBust();
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
