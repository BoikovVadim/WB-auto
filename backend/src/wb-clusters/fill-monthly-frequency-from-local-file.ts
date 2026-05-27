/**
 * One-shot import of a local WB search analytics ZIP/XLSX file.
 *
 * Usage:
 *   npx ts-node ... fill-monthly-frequency-from-local-file.ts \
 *     --file="/path/to/file.zip" \
 *     --from="2026-04-06" \
 *     --to="2026-05-05"
 */
import { readFileSync } from "node:fs";

import { Client } from "pg";

import AdmZip from "adm-zip";

import {
  parseMonthlyFrequencyWorkbookBuffer,
} from "./monthly-frequency-analytics.ingest";
import {
  countMonthlyFrequencySnapshotRows,
  ensureMonthlyFrequencyTable,
  getRequiredMonthlyFrequencyPostgresConfig,
  loadMonthlyFrequencySnapshotSample,
  replaceMonthlyFrequencySnapshot,
} from "./monthly-frequency-import.persistence";
import {
  buildSafariImportApiBaseUrl,
  loadSafariImportEnv,
} from "./safari-import.env";

function extractWorkbookBuffer(filePath: string, rawBuffer: Buffer): Buffer {
  if (!/\.zip$/i.test(filePath)) return rawBuffer;
  const zip = new AdmZip(rawBuffer);
  const xlsxEntry = zip.getEntries().find((e) => /\.xlsx$/i.test(e.entryName));
  if (!xlsxEntry) {
    throw new Error(`No XLSX file found inside ZIP archive: ${filePath}`);
  }
  return xlsxEntry.getData();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};
  for (const arg of args) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAdvertisingText(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
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
    if (writeKey) {
      headers["x-wb-write-key"] = writeKey;
    }
    const res = await fetch(url, { method: "POST", headers });
    if (res.ok) {
      const body = await res.json() as { clearedAt?: string };
      console.log(`\nServer caches cleared at ${body.clearedAt ?? "unknown"}. Frequency data is live immediately.`);
    } else {
      console.warn(`\nCache-bust request returned ${res.status}. Server caches will expire naturally (TTL).`);
    }
  } catch (err) {
    console.warn(
      `\nCould not reach server to bust caches (${(err as Error).message}). ` +
      `Frequency data will appear after cache TTL expiry (up to 65 min).`,
    );
  }
}

async function main() {
  const args = parseArgs();
  const filePath = args.file;
  const from = args.from;
  const to = args.to;

  if (!filePath || !from || !to) {
    throw new Error(
      "Usage: --file=/path/to/file.zip --from=YYYY-MM-DD --to=YYYY-MM-DD",
    );
  }

  console.log(`Importing from local file: ${filePath}`);
  console.log(`Period: ${from}..${to}`);

  const rawBuffer = readFileSync(filePath);

  const workbookBuffer = extractWorkbookBuffer(filePath, rawBuffer);

  const rows = parseMonthlyFrequencyWorkbookBuffer({
    workbookBuffer,
    readOptionalString,
    normalizeAdvertisingText,
  });

  if (rows.length === 0) {
    throw new Error("Could not parse any rows from the file.");
  }
  console.log(`Parsed ${rows.length} rows from workbook.`);

  const client = new Client(getRequiredMonthlyFrequencyPostgresConfig());
  await client.connect();

  try {
    await ensureMonthlyFrequencyTable(client);

    const rowsUpserted = await replaceMonthlyFrequencySnapshot(client, {
      rows,
      reportType: "FREE_SEARCH_ANALYTICS_PORTAL_XLSX",
      reportId: filePath,
      downloadId: filePath,
      period: { from, to },
      normalizeAdvertisingText,
    });

    const snapshotRows = await countMonthlyFrequencySnapshotRows(client);
    const sample = await loadMonthlyFrequencySnapshotSample(client, 10);

    console.log(`Rows upserted: ${rowsUpserted}`);
    console.log(`Current snapshot rows: ${snapshotRows}`);
    console.log(`Sample:\n${JSON.stringify(sample, null, 2)}`);
  } finally {
    await client.end();
  }

  // Bust production server caches so the new data is visible immediately.
  await notifyFrequencyCacheBust();
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
