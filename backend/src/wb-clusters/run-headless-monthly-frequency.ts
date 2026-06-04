/**
 * Headless-выгрузка частотности по категориям (без Safari) — Playwright + storageState.
 * Зеркало fill-monthly-frequency-by-category.ts, но скачивание идёт headless-клиентом
 * (create → poll → x-download-token → файл) в одном окне на все категории.
 *
 * Запуск (нужен DATABASE_URL — обычно через SSH-туннель к проду):
 *   cd backend && npx ts-node --project tsconfig.json src/wb-clusters/run-headless-monthly-frequency.ts
 *   DRY_RUN=1 — только скачать+посчитать по категориям, БЕЗ записи в БД (проверка).
 *   CATEGORY_FILTER="A,B" — ограничить категории.
 */
import path from "node:path";

import AdmZip from "adm-zip";
import { Client } from "pg";

import { parseMonthlyFrequencyWorkbookBuffer } from "./monthly-frequency-analytics.ingest";
import type { MonthlyFrequencyRow } from "./monthly-frequency-analytics.types";
import {
  ensureMonthlyFrequencyTable,
  getRequiredMonthlyFrequencyPostgresConfig,
  replaceMonthlyFrequencySnapshot,
} from "./monthly-frequency-import.persistence";
import { getDefaultMonthlyFrequencyImportPeriod } from "./monthly-frequency-import.period";
import { ensureWbSession } from "./ensure-wb-session";
import { macNotify } from "./mac-notify";
import { WB_ANALYTICS_CATEGORY_SUBJECT_IDS } from "./wb-analytics-category-subjects";
import { WbContentAnalyticsHeadlessClient } from "./wb-content-analytics-headless.client";

const REPORT_TYPE = "SEARCH_ANALYSIS_PREMIUM_REPORT" as const;
const MAX_ROWS = 300_000;
const STORAGE_STATE_PATH =
  process.env.WB_CABINET_STORAGE_STATE_PATH ||
  path.join(process.cwd(), "data", "wb-cabinet-storage-state.json");

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function normalizeAdvertisingText(value: string): string {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
}
function normalizeQueryIdentity(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/[_/\\|.,:;!?()[\]{}"'+=*%#№@`~^&-]+/g, " ")
    .replace(/\s+/g, " ");
}

function extractRowsFromZip(buffer: Buffer): MonthlyFrequencyRow[] {
  const zip = new AdmZip(buffer);
  const xlsxEntry = zip.getEntries().find((entry) => /\.xlsx$/i.test(entry.entryName));
  if (!xlsxEntry) throw new Error("XLSX внутри ZIP не найден.");
  return parseMonthlyFrequencyWorkbookBuffer({
    workbookBuffer: xlsxEntry.getData(),
    readOptionalString,
    normalizeAdvertisingText,
  });
}

/** Категории товаров продавца (имена) — их маппим на аналитический subjectID. */
async function loadSellerCategoryNames(client: Client): Promise<string[]> {
  const result = await client.query<{ category_name: string }>(
    `SELECT DISTINCT category_name
     FROM public.wb_product_catalog
     WHERE category_name IS NOT NULL
     ORDER BY category_name`,
  );
  return result.rows.map((r) => r.category_name.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  const dryRun = (process.env.DRY_RUN ?? "").trim() === "1";
  const categoryFilter = (process.env.CATEGORY_FILTER ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const defaultPeriod = getDefaultMonthlyFrequencyImportPeriod();
  const period = {
    from: (process.env.WB_MONTHLY_FREQUENCY_IMPORT_FROM ?? "").trim() || defaultPeriod.from,
    to: (process.env.WB_MONTHLY_FREQUENCY_IMPORT_TO ?? "").trim() || defaultPeriod.to,
  };

  console.log(`=== Headless Monthly Frequency by Category ===`);
  console.log(`Период: ${period.from} → ${period.to} | DRY_RUN: ${dryRun}`);

  // Категории → subjectIds из БД.
  const dbClient = new Client(getRequiredMonthlyFrequencyPostgresConfig());
  await dbClient.connect();
  let sellerNames: string[];
  try {
    await ensureMonthlyFrequencyTable(dbClient);
    sellerNames = await loadSellerCategoryNames(dbClient);
  } finally {
    await dbClient.end();
  }

  // Маппинг названий категорий продавца → аналитический subjectID (по одной на категорию).
  let categories: Array<[string, number]> = [];
  const unmatched: string[] = [];
  for (const name of sellerNames) {
    const id = WB_ANALYTICS_CATEGORY_SUBJECT_IDS[name];
    if (typeof id === "number") categories.push([name, id]);
    else unmatched.push(name);
  }
  if (categoryFilter.length > 0) {
    categories = categories.filter(([name]) => categoryFilter.includes(name));
  }
  if (categories.length === 0) {
    throw new Error("Ни одна категория продавца не сматчилась с картой subjectID (или фильтр пуст).");
  }
  console.log(`Категорий к выгрузке: ${categories.length}`);
  if (unmatched.length > 0) {
    console.log(`Без аналитического subjectID (пропускаю): ${unmatched.join(", ")}`);
  }

  // Login-on-demand: жива ли сессия? Если нет — откроется окно входа, ждём.
  await ensureWbSession({ storageStatePath: STORAGE_STATE_PATH, log: (m) => console.log(m) });

  const client = new WbContentAnalyticsHeadlessClient({
    storageStatePath: STORAGE_STATE_PATH,
    headless: true,
  });

  const globalRows = new Map<string, MonthlyFrequencyRow>();
  const stats: Array<{ category: string; rows: number; passes: number; error?: string }> = [];

  await client.runImportSession(REPORT_TYPE, async (session) => {
    for (const [categoryName, subjectId] of categories) {
      const t0 = Date.now();
      try {
        const desc = await session.createAndDownload([subjectId], "desc");
        const rows1 = extractRowsFromZip(desc.buffer);
        let rows = rows1;
        let passes = 1;
        if (rows1.length >= MAX_ROWS) {
          // Возможна обрезка по 300k — добираем хвост по возрастанию и мёржим.
          const asc = await session.createAndDownload([subjectId], "asc");
          const rows2 = extractRowsFromZip(asc.buffer);
          const merged = new Map<string, MonthlyFrequencyRow>();
          for (const r of [...rows1, ...rows2]) {
            const k = normalizeQueryIdentity(r.queryText);
            const e = merged.get(k);
            if (!e || r.monthlyFrequency > e.monthlyFrequency) merged.set(k, r);
          }
          rows = Array.from(merged.values());
          passes = 2;
        }
        for (const r of rows) {
          const k = normalizeQueryIdentity(r.queryText);
          const e = globalRows.get(k);
          if (!e || r.monthlyFrequency > e.monthlyFrequency) globalRows.set(k, r);
        }
        stats.push({ category: categoryName, rows: rows.length, passes });
        console.log(
          `  ✓ [${categoryName}] ${rows.length} строк${passes === 2 ? " (2 прохода)" : ""}` +
            ` за ${Math.round((Date.now() - t0) / 1000)}с | глобально: ${globalRows.size}`,
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        stats.push({ category: categoryName, rows: 0, passes: 0, error: msg });
        console.error(`  ✗ [${categoryName}] FAILED: ${msg}`);
      }
    }
  });

  console.log(`\n=== Итог скачивания ===`);
  const ok = stats.filter((s) => s.rows > 0).length;
  const failed = stats.filter((s) => s.rows === 0);
  console.log(`Категорий успешно: ${ok}/${stats.length} | уникальных строк: ${globalRows.size}`);
  if (failed.length) {
    console.log(`Провалились (${failed.length}):`);
    for (const s of failed) console.log(`  ✗ ${s.category}: ${s.error ?? "0 строк"}`);
  }

  if (dryRun) {
    console.log("\nDRY_RUN — в БД ничего не пишу.");
    return;
  }
  if (failed.length > 0) {
    throw new Error(`Есть упавшие категории (${failed.length}) — НЕ импортирую, чтобы не затереть прод неполными данными. Разберись и перезапусти.`);
  }

  console.log(`\n=== Импорт ${globalRows.size} строк в БД ===`);
  const importClient = new Client(getRequiredMonthlyFrequencyPostgresConfig());
  await importClient.connect();
  try {
    const upserted = await replaceMonthlyFrequencySnapshot(importClient, {
      rows: Array.from(globalRows.values()),
      reportType: "SEARCH_ANALYSIS_PREMIUM_REPORT_BY_CATEGORY",
      reportId: `headless-by-category-${period.from}-${period.to}`,
      downloadId: `headless-by-category-${period.from}-${period.to}`,
      period,
      normalizeAdvertisingText,
    });
    console.log(`Готово. Upserted: ${upserted}`);
    macNotify("Частоты обновлены", `Импортировано ${upserted} строк по ${ok} категориям.`);
  } finally {
    await importClient.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Раннер упал: ${msg}`);
    macNotify("Частоты: ошибка", msg.slice(0, 200));
    process.exit(1);
  });
