/**
 * Fast bulk updater for wb_cabinet_cluster_queries.
 *
 * Strategy: open ONE Safari window to cmp.wildberries.ru.
 * Process advertIds in batches of BATCH_SIZE.
 * For each batch:
 *   1. Inject JS that runs CONCURRENCY parallel fetches for those advertIds.
 *   2. Poll until all batch fetches complete.
 *   3. Collect all results (guaranteed to fit in memory: BATCH_SIZE * ~200KB).
 *   4. Save to PostgreSQL with UNNEST (one query per nmId).
 *   5. Move to the next batch.
 *
 * This avoids memory overflow from storing all 992 results at once,
 * and is ~50-100x faster than opening one Safari page per (advertId, nmId) pair.
 *
 * Prerequisites:
 *   - macOS (Darwin)
 *   - Safari open with cmp.wildberries.ru logged in
 *   - SSH tunnel or direct access to production PostgreSQL
 *
 * Usage:
 *   cd backend
 *   DATABASE_URL=postgres://... npx ts-node src/wb-clusters/fill-query-map-from-cmp-api.ts
 *
 * Optional env:
 *   WB_CMP_BATCH_SIZE   advertIds per browser batch (default: 40)
 *   WB_CMP_CONCURRENCY  parallel fetches within each batch (default: 10)
 *   WB_CMP_POLL_MS      poll interval when waiting for batch (default: 1500)
 */

import { Client } from "pg";

import {
  buildCabinetQueryMapSourceEndpoint,
  parseCabinetQueryMapWorkbookBuffer,
  replaceCabinetQueryMapRows,
} from "./cabinet-query-map-safari-import";
import {
  buildOptionalSafariImportPostgresConfig,
  buildSafariImportApiBaseUrl,
  loadSafariImportEnv,
} from "./safari-import.env";
import { ensureDarwinSafariRuntime } from "./safari-import.runtime";
import {
  ensureCmpAuth,
  ensureCmpWindowId,
  injectIntoWindow,
} from "./fill-query-map-cmp-window";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BATCH_SIZE = Number.parseInt(process.env.WB_CMP_BATCH_SIZE ?? "40", 10);
const CONCURRENCY = Number.parseInt(process.env.WB_CMP_CONCURRENCY ?? "10", 10);
const POLL_INTERVAL_MS = Number.parseInt(process.env.WB_CMP_POLL_MS ?? "1500", 10);

// ---------------------------------------------------------------------------
// Browser scripts
// ---------------------------------------------------------------------------

/**
 * Injects a fresh batch fetch.  Resets all window.__qm* state so stale runs
 * from a previous batch don't interfere.
 */
function buildBatchStartScript(advertIds: number[]): string {
  return `(function () {
  window.__qmRunning = true;
  window.__qmResults = {};
  window.__qmFinished = false;
  window.__qmPending = ${advertIds.length};
  window.__qmError   = null;

  var token = localStorage.getItem("access-token") || "";
  var sm    = document.cookie.match(/(?:^|; )x-supplier-id-external=([^;]+)/);
  var supp  = sm ? decodeURIComponent(sm[1]) : "";

  if (!token || !supp) {
    window.__qmError    = "no-auth: token=" + (token?"ok":"empty") + " supplier=" + (supp?"ok":"empty");
    window.__qmFinished = true;
    return "auth-error:" + window.__qmError;
  }

  var ids        = ${JSON.stringify(advertIds)};
  var queue      = ids.slice();
  var active     = 0;
  var completed  = 0;
  var total      = ids.length;
  var conc       = ${CONCURRENCY};

  function fetchOne(id) {
    active++;
    fetch("/api/v5/words-clusters?advertID=" + id, {
      credentials: "include",
      headers: { "AuthorizeV3": token, "x-supplierid": supp, "Lang": "ru" }
    }).then(function(r) {
      if (!r.ok) {
        window.__qmResults[id] = { ok: false, status: r.status };
        return Promise.resolve();
      }
      return r.arrayBuffer().then(function(buf) {
        var b = new Uint8Array(buf), bin = "", cs = 8192;
        for (var i = 0; i < b.length; i += cs)
          bin += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + cs)));
        window.__qmResults[id] = { ok: true, base64: btoa(bin) };
      });
    }).catch(function(e) {
      window.__qmResults[id] = { ok: false, error: String(e) };
    }).finally(function() {
      active--;
      completed++;
      window.__qmPending = total - completed;
      if (completed >= total) window.__qmFinished = true;
      else pump();
    });
  }

  function pump() {
    while (active < conc && queue.length > 0) fetchOne(queue.shift());
  }
  pump();
  return "started:" + total;
})()`.trim();
}

/** Returns status + up to maxItems completed results (deleting them from window). */
function buildPollScript(maxItems: number): string {
  return `(function () {
  var alive = typeof window.__qmRunning !== "undefined";
  if (!alive) {
    return JSON.stringify({ alive: false, pending: 0, done: {}, finished: true, error: "page-reset" });
  }
  var done = {}, count = 0;
  var keys = Object.keys(window.__qmResults || {});
  for (var i = 0; i < keys.length && count < ${maxItems}; i++) {
    var k = keys[i];
    done[k] = window.__qmResults[k];
    delete window.__qmResults[k];
    count++;
  }
  return JSON.stringify({
    alive:    true,
    pending:  window.__qmPending  || 0,
    done:     done,
    finished: window.__qmFinished || false,
    error:    window.__qmError    || null
  });
})()`.trim();
}

// Safari-автоматизация окна cmp + восстановление cmp-сессии вынесены в
// ./fill-query-map-cmp-window.ts (см. импорт сверху).

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

type AdvertNmMap = Map<number, number[]>;

async function loadAdvertNmMap(client: Client): Promise<AdvertNmMap> {
  // Only active (9) and paused (11) campaigns — archived (7) are skipped.
  // ПОРЯДОК — «самые несвежие первыми» (captured_at ASC, NULL=никогда → первыми):
  // WB-сессия живёт ограниченно (~45 мин), за прогон успевает ~30-40 РК, поэтому
  // важно ротировать — иначе хвост по advert_id никогда бы не обновлялся.
  const { rows } = await client.query<{ advert_id: string; nm_id: string }>(
    `SELECT cp.advert_id::text, cp.nm_id::text
     FROM public.wb_campaign_products cp
     JOIN public.wb_campaigns c ON c.advert_id = cp.advert_id
     LEFT JOIN public.wb_cabinet_cluster_queries q
       ON q.advert_id = cp.advert_id AND q.nm_id = cp.nm_id
     WHERE c.campaign_status IN (9, 11)
     GROUP BY cp.advert_id, cp.nm_id
     ORDER BY MAX(q.captured_at) ASC NULLS FIRST, cp.advert_id, cp.nm_id`,
  );
  const map: AdvertNmMap = new Map();
  for (const row of rows) {
    const advertId = Number(row.advert_id);
    const nmId = Number(row.nm_id);
    if (!map.has(advertId)) map.set(advertId, []);
    map.get(advertId)!.push(nmId);
  }
  return map;
}

async function loadAdvertNmMapViaApi(apiBaseUrl: string): Promise<AdvertNmMap> {
  // mode=active filters to campaign_status IN (9, 11) on the backend
  const res = await fetch(`${apiBaseUrl}/wb-clusters/cabinet/query-map/candidates?limit=9999&mode=active`);
  if (!res.ok) throw new Error(`Candidates API returned HTTP ${res.status}`);
  const payload = (await res.json()) as { candidates?: Array<{ advertId?: number; nmId?: number }> };
  if (!Array.isArray(payload.candidates)) throw new Error("Invalid candidates payload.");
  const map: AdvertNmMap = new Map();
  for (const c of payload.candidates) {
    if (typeof c.advertId !== "number" || typeof c.nmId !== "number") continue;
    if (!map.has(c.advertId)) map.set(c.advertId, []);
    map.get(c.advertId)!.push(c.nmId);
  }
  return map;
}

async function importViaApi(
  apiBaseUrl: string,
  advertId: number,
  nmId: number,
  rows: Array<{ clusterName: string; queryText: string }>,
  capturedAt: string,
) {
  const chunkSize = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const res = await fetch(`${apiBaseUrl}/wb-clusters/cabinet/query-map/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        advertId, nmId, capturedAt,
        captureMode: "safari-single-tab-words-clusters",
        sourceEndpoint: buildCabinetQueryMapSourceEndpoint(advertId),
        replaceExisting: i === 0,
        rows: rows.slice(i, i + chunkSize),
      }),
    });
    if (!res.ok) throw new Error(`API HTTP ${res.status} for advert ${advertId} nm ${nmId}`);
    const p = (await res.json()) as { rowsStored?: number };
    total += p.rowsStored ?? 0;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function main() {
  loadSafariImportEnv();
  ensureDarwinSafariRuntime("This script requires macOS + Safari for browser-based auth.");

  const pgConfig = buildOptionalSafariImportPostgresConfig();
  const apiBaseUrl = buildSafariImportApiBaseUrl();
  const client = pgConfig ? new Client(pgConfig) : null;
  if (client) {
    await client.connect();
    // Крупные РК дают долгий UNNEST-INSERT; дефолтный statement_timeout прода рубил
    // сохранение ("canceling statement due to statement timeout"). Поднимаем для сессии импорта.
    await client.query("SET statement_timeout = '180s'");
    console.log("Connected to PostgreSQL directly.");
  } else {
    console.log(`No direct DB — uploading via API: ${apiBaseUrl}`);
  }

  try {
    const advertNmMap: AdvertNmMap = client
      ? await loadAdvertNmMap(client)
      : await loadAdvertNmMapViaApi(apiBaseUrl);

    const allAdvertIds = [...advertNmMap.keys()];
    const totalPairs = [...advertNmMap.values()].reduce((s, a) => s + a.length, 0);
    console.log(
      `Loaded ${allAdvertIds.length} unique advertIds → ${totalPairs} (advertId, nmId) pairs.`,
    );
    console.log(
      `Batch config: BATCH_SIZE=${BATCH_SIZE} CONCURRENCY=${CONCURRENCY} POLL_MS=${POLL_INTERVAL_MS}`,
    );

    let windowId = await ensureCmpWindowId();
    console.log(`Safari window id: ${windowId}. Starting batch processing...\n`);

    let succeededAdverts = 0;
    let failedAdverts = 0;
    let pairsUpdated = 0;
    const capturedAt = new Date().toISOString();
    const pollScript = buildPollScript(BATCH_SIZE); // collect up to full batch at once

    for (let batchStart = 0; batchStart < allAdvertIds.length; batchStart += BATCH_SIZE) {
      const batchIds = allAdvertIds.slice(batchStart, batchStart + BATCH_SIZE);
      const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allAdvertIds.length / BATCH_SIZE);

      process.stdout.write(
        `[Batch ${batchNum}/${totalBatches}] ${batchIds.length} adverts...`,
      );

      // Проактивно проверяем, что окно на cmp и токен жив (он короткоживущий).
      // ensureCmpAuth может вернуть ДРУГОЙ id (если окно пере-захвачено) — обновляем.
      {
        const wid = await ensureCmpAuth(windowId);
        if (wid == null) {
          throw new Error(
            "WB-сессия cmp.wildberries.ru недоступна (токен не обновился). " +
              "Залогинься в cmp.wildberries.ru в Safari и перезапусти.",
          );
        }
        windowId = wid;
      }

      // Inject start script (resets window state for this batch)
      let startResult = await injectIntoWindow(windowId, buildBatchStartScript(batchIds), 20_000);
      if (startResult.startsWith("auth-error:")) {
        // Токен мог протухнуть между проверкой и стартом — обновляем и повторяем батч раз.
        console.warn("\n  auth-error на старте батча — обновляю cmp-сессию и повторяю...");
        const wid = await ensureCmpAuth(windowId);
        if (wid == null) {
          throw new Error(
            "WB-сессия cmp.wildberries.ru потеряна и не восстановилась. " +
              "Залогинься в cmp.wildberries.ru в Safari и перезапусти.",
          );
        }
        windowId = wid;
        startResult = await injectIntoWindow(windowId, buildBatchStartScript(batchIds), 20_000);
        if (startResult.startsWith("auth-error:")) {
          throw new Error(`WB auth всё ещё отсутствует после обновления сессии: ${startResult}`);
        }
      }

      // Poll until all batch fetches complete AND all results collected
      const batchDone: Record<string, { ok: boolean; base64?: string; status?: number; error?: string }> = {};
      let attempts = 0;
      const maxAttempts = Math.ceil((batchIds.length * 3000) / POLL_INTERVAL_MS) + 20; // generous timeout

      while (attempts < maxAttempts) {
        await sleep(POLL_INTERVAL_MS);
        attempts++;

        const raw = await injectIntoWindow(windowId, pollScript, 15_000);
        const poll = JSON.parse(raw) as {
          alive: boolean;
          pending: number;
          done: Record<string, { ok: boolean; base64?: string; status?: number; error?: string }>;
          finished: boolean;
          error: string | null;
        };

        if (!poll.alive) {
          // Page was reset OR WB redirected to seller.wildberries.ru (token expired).
          const remaining = batchIds.filter((id) => !(id in batchDone));
          if (remaining.length === 0) break;
          console.warn(`\n  Page reset/redirect — re-auth + re-injecting ${remaining.length} adverts...`);
          const wid = await ensureCmpAuth(windowId);
          if (wid == null) {
            throw new Error(
              "WB-сессия потеряна посреди батча и не восстановилась. " +
                "Залогинься в cmp.wildberries.ru в Safari и перезапусти.",
            );
          }
          windowId = wid;
          await injectIntoWindow(windowId, buildBatchStartScript(remaining), 20_000);
          continue;
        }

        // Accumulate collected results
        Object.assign(batchDone, poll.done);

        if (poll.finished && poll.pending === 0 && Object.keys(poll.done).length === 0) {
          // Drain any remaining (should be empty after final poll)
          const finalRaw = await injectIntoWindow(windowId, pollScript, 15_000);
          const final = JSON.parse(finalRaw) as typeof poll;
          Object.assign(batchDone, final.done);
          break;
        }
      }

      // Process collected results
      let batchOk = 0;
      let batchFail = 0;
      for (const [advertIdStr, result] of Object.entries(batchDone)) {
        const advertId = Number(advertIdStr);
        if (!result.ok) {
          batchFail++;
          continue;
        }
        try {
          const buffer = Buffer.from(result.base64!, "base64");
          const parsedRows = parseCabinetQueryMapWorkbookBuffer(buffer);
          const nmIds = advertNmMap.get(advertId) ?? [];
          for (const nmId of nmIds) {
            if (client) {
              await replaceCabinetQueryMapRows(client, {
                advertId,
                nmId,
                rows: parsedRows,
                capturedAt,
                captureMode: "safari-single-tab-words-clusters",
                sourceEndpoint: buildCabinetQueryMapSourceEndpoint(advertId),
              });
            } else {
              await importViaApi(apiBaseUrl, advertId, nmId, parsedRows, capturedAt);
            }
            pairsUpdated++;
          }
          batchOk++;
        } catch (err) {
          batchFail++;
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`\n  advert ${advertIdStr} save error: ${msg}`);
        }
      }

      succeededAdverts += batchOk;
      failedAdverts += batchFail;

      const pct = Math.round(((batchStart + batchIds.length) / allAdvertIds.length) * 100);
      console.log(
        ` ok=${batchOk} fail=${batchFail} | total: ${succeededAdverts}/${allAdvertIds.length} (${pct}%) pairs=${pairsUpdated}`,
      );
    }

    console.log(
      `\nDone. Adverts: ${succeededAdverts} ok, ${failedAdverts} failed. Pairs updated: ${pairsUpdated}.`,
    );
  } finally {
    if (client) await client.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
