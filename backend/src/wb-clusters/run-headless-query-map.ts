/**
 * Headless-обновление карты запросов кластеров (wb_cabinet_cluster_queries).
 * Замена Safari-механизма (fill-query-map-from-cmp-api): Playwright + storageState,
 * без видимого браузера. Login-on-demand: мёртвая сессия → окно входа.
 *
 * Запуск: ts-node run-headless-query-map.ts   (env: WB_QM_BATCH_SIZE, WB_QM_CONCURRENCY)
 */
import path from "node:path";

import { Client } from "pg";

import {
  buildCabinetQueryMapSourceEndpoint,
  parseCabinetQueryMapWorkbookBuffer,
  replaceCabinetQueryMapRows,
} from "./cabinet-query-map-safari-import";
import { loadCabinetQueryMapCandidates } from "./cabinet-query-map.candidates";
import { ensureWbSession } from "./ensure-wb-session";
import { macNotify } from "./mac-notify";
import { WbCmpHeadlessClient } from "./wb-cmp-headless.client";

const STORAGE_STATE_PATH =
  process.env.WB_CABINET_STORAGE_STATE_PATH ||
  path.join(process.cwd(), "data", "wb-cabinet-storage-state.json");
const BATCH_SIZE = Number.parseInt(process.env.WB_QM_BATCH_SIZE ?? "15", 10);
const CONCURRENCY = Number.parseInt(process.env.WB_QM_CONCURRENCY ?? "10", 10);
// Ограничение числа РК за прогон (для ручного теста); 0/пусто = все кандидаты.
const LIMIT = Number.parseInt(process.env.WB_QM_LIMIT ?? "0", 10);
const CAPTURE_MODE = "headless-words-clusters";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан (нужен для записи карты запросов).");
  return url;
}

async function main(): Promise<void> {
  console.log("=== Headless Query-Map Update (cmp words-clusters) ===");
  console.log(`Batch=${BATCH_SIZE} Concurrency=${CONCURRENCY}`);

  // Login-on-demand для cmp (отдельная сессия от content-analytics частот).
  await ensureWbSession({ storageStatePath: STORAGE_STATE_PATH, target: "cmp", log: (m) => console.log(m) });

  const client = new Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  // Крупные РК дают долгий UNNEST-INSERT — поднимаем дефолтный statement_timeout прода.
  await client.query("SET statement_timeout = '180s'");

  let okAdverts = 0;
  let failedAdverts = 0;
  let pairsUpdated = 0;
  try {
    const advertNmMap = await loadCabinetQueryMapCandidates(client);
    let advertIds = [...advertNmMap.keys()];
    if (LIMIT > 0) advertIds = advertIds.slice(0, LIMIT);
    const totalPairs = advertIds.reduce((s, id) => s + (advertNmMap.get(id)?.length ?? 0), 0);
    console.log(`Кандидатов: ${advertIds.length} РК → ${totalPairs} пар (advertId, nmId).`);

    const cmp = new WbCmpHeadlessClient({
      storageStatePath: STORAGE_STATE_PATH,
      concurrency: CONCURRENCY,
      log: (m) => console.log(m),
    });
    const capturedAt = new Date().toISOString();

    await cmp.runSession(async (api) => {
      const totalBatches = Math.ceil(advertIds.length / BATCH_SIZE);
      for (let start = 0; start < advertIds.length; start += BATCH_SIZE) {
        const batchIds = advertIds.slice(start, start + BATCH_SIZE);
        const batchNum = Math.floor(start / BATCH_SIZE) + 1;
        const buffers = await api.fetchClusterBatch(batchIds);

        for (const advertId of batchIds) {
          const buffer = buffers.get(advertId);
          if (!buffer) {
            failedAdverts += 1;
            continue;
          }
          try {
            const rows = parseCabinetQueryMapWorkbookBuffer(buffer);
            for (const nmId of advertNmMap.get(advertId) ?? []) {
              await replaceCabinetQueryMapRows(client, {
                advertId,
                nmId,
                rows,
                capturedAt,
                captureMode: CAPTURE_MODE,
                sourceEndpoint: buildCabinetQueryMapSourceEndpoint(advertId),
              });
              pairsUpdated += 1;
            }
            okAdverts += 1;
          } catch (err) {
            failedAdverts += 1;
            console.warn(`  advert ${advertId} save error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const pct = Math.round(((start + batchIds.length) / advertIds.length) * 100);
        console.log(`[${batchNum}/${totalBatches}] ${pct}% | ok=${okAdverts} fail=${failedAdverts} pairs=${pairsUpdated}`);
      }
    });

    console.log(`\nГотово. РК: ${okAdverts} ok, ${failedAdverts} fail. Пар обновлено: ${pairsUpdated}.`);
    macNotify("Карта запросов обновлена", `${okAdverts} РК, ${pairsUpdated} пар.`);
  } finally {
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Раннер упал: ${msg}`);
    macNotify("Карта запросов: ошибка", msg.slice(0, 200));
    process.exit(1);
  });
