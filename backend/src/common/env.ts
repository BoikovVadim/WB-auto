import path from "node:path";
import dotenv from "dotenv";

const envFiles = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(process.cwd(), "..", ".env.local"),
];

for (const envFile of envFiles) {
  dotenv.config({ path: envFile, override: true });
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getOptionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function parseBooleanEnv(name: string, fallback: string): boolean {
  const rawValue = getOptionalEnv(name, fallback).trim().toLowerCase();

  if (rawValue === "true" || rawValue === "1" || rawValue === "yes") {
    return true;
  }

  if (rawValue === "false" || rawValue === "0" || rawValue === "no") {
    return false;
  }

  throw new Error(`Invalid ${name} value: ${rawValue}`);
}

function parsePositiveIntegerEnv(
  name: string,
  fallback: string,
  minimum = 0,
): number {
  const rawValue = getOptionalEnv(name, fallback).trim();
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`Invalid ${name} value: ${rawValue}`);
  }

  return value;
}

function getOptionalNullablePathEnv(name: string): string | null {
  const rawValue = (process.env[name] ?? "").trim();
  return rawValue ? path.resolve(rawValue) : null;
}

function getOptionalPathEnv(name: string, fallback: string): string {
  const value = getOptionalEnv(name, fallback).trim();

  if (!value) {
    throw new Error(`Invalid path in environment variable: ${name}`);
  }

  return path.resolve(value);
}

function parsePort(rawValue: string): number {
  const port = Number(rawValue);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid BACKEND_PORT value: ${rawValue}`);
  }

  return port;
}

function getOptionalUrlEnv(name: string, fallback: string): string {
  const value = getOptionalEnv(name, fallback);

  try {
    const url = new URL(value);
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid URL in environment variable: ${name}`);
  }
}

function resolvePostgresConfig() {
  const connectionString = (process.env.DATABASE_URL ?? "").trim();
  const ssl = parseBooleanEnv("PGSSL", "false");
  const schema = getOptionalEnv("PGSCHEMA", "public").trim() || "public";

  if (connectionString) {
    return {
      enabled: true,
      connectionString,
      ssl,
      schema,
    };
  }

  const host = (process.env.PGHOST ?? "").trim();
  const user = (process.env.PGUSER ?? "").trim();
  const password = (process.env.PGPASSWORD ?? "").trim();
  const database = (process.env.PGDATABASE ?? "").trim();

  if (!host || !user || !database) {
    return {
      enabled: false,
      ssl,
      schema,
    };
  }

  return {
    enabled: true,
    host,
    port: parsePositiveIntegerEnv("PGPORT", "5432", 1),
    user,
    password,
    database,
    ssl,
    schema,
  };
}

export const appEnv = {
  nodeEnv: getOptionalEnv("NODE_ENV", "development"),
  port: parsePort(getOptionalEnv("BACKEND_PORT", "3000")),
  // ГЛОБАЛЬНЫЙ РУБИЛЬНИК «только чтение»: при WB_AUTOMATION_READ_ONLY=true ни один
  // автоматический движок НЕ пишет в кабинет WB (вкл/выкл кластеров, DRR-регулятор,
  // ставки) — синки/расчёты/накопители работают как обычно. Нужен, чтобы поднять
  // ВТОРОЙ экземпляр (миграция в Oqqi) рядом с боевым без двух одновременных писателей
  // в один кабинет (rate-limit/конфликт действий). Дефолт false — боевой пишет.
  wbAutomationReadOnly: parseBooleanEnv("WB_AUTOMATION_READ_ONLY", "false"),
  frontendOrigin: getOptionalUrlEnv(
    "FRONTEND_ORIGIN",
    "http://localhost:5173",
  ),
  wbApiBaseUrl: getOptionalUrlEnv(
    "WB_API_BASE_URL",
    "https://seller-analytics-api.wildberries.ru",
  ),
  wbApiTimeoutMs: parsePositiveIntegerEnv("WB_API_TIMEOUT_MS", "45000", 1),
  wbApiMinIntervalMs: parsePositiveIntegerEnv("WB_API_MIN_INTERVAL_MS", "21000"),
  // WB /api/v2/search-report/product/search-texts has an account-wide quota of
  // ~700 req/hr. 6 000 ms gives ~600 req/hr — safely under the limit.
  // Do NOT reduce below ~5 200 ms (≈ 692 req/hr) or WB will return 429s and
  // trigger a 60-second back-off that makes the backfill take much longer.
  wbJamMinIntervalMs: parsePositiveIntegerEnv("WB_JAM_MIN_INTERVAL_MS", "6000"),
  wbApiRetryAttempts: parsePositiveIntegerEnv("WB_API_RETRY_ATTEMPTS", "2"),
  wbApiRetryBaseDelayMs: parsePositiveIntegerEnv("WB_API_RETRY_BASE_DELAY_MS", "2000"),
  wbApiRetryMaxDelayMs: parsePositiveIntegerEnv("WB_API_RETRY_MAX_DELAY_MS", "8000"),
  wbDefaultLocale: getOptionalEnv("WB_DEFAULT_LOCALE", "ru"),
  wbApiToken: (process.env.WB_API_TOKEN ?? "").trim(),
  // WB Statistics API (statistics-api.wildberries.ru) — same token as wbApiToken.
  // Data: orders, sales. Max lookback: 90 days. Rate limit: 1 req/min.
  wbStatisticsApiBaseUrl: getOptionalUrlEnv(
    "WB_STATISTICS_API_BASE_URL",
    "https://statistics-api.wildberries.ru",
  ),
  wbStatisticsApiTimeoutMs: parsePositiveIntegerEnv("WB_STATISTICS_API_TIMEOUT_MS", "60000", 1),
  // 62 000 ms = just over 1 minute; ensures we never exceed 1 req/min
  wbStatisticsApiMinIntervalMs: parsePositiveIntegerEnv("WB_STATISTICS_API_MIN_INTERVAL_MS", "62000"),
  // WB Seller Analytics API (seller-analytics-api.wildberries.ru) — Analytics token category.
  // Provides "Заказали товаров" metric matching WB dashboard (воронка продаж).
  // Rate limit: 3 req/min. Data updates: once per hour.
  wbSellerAnalyticsApiBaseUrl: getOptionalUrlEnv(
    "WB_SELLER_ANALYTICS_API_BASE_URL",
    "https://seller-analytics-api.wildberries.ru",
  ),
  wbOrdersSyncEnabled: parseBooleanEnv("WB_ORDERS_SYNC_ENABLED", "true"),
  // Освежение заказов за СЕГОДНЯ через Sales Funnel (Воронку, эндпоинт /products).
  // orderCount/orderSum/cancelCount совпадают с кабинетом WB «Заказали товаров»
  // (Statistics API занижал ~12% — выкидывал неоплаченные заказы). Все активные
  // товары приходят за ОДИН запрос (пагинация по 1000), поэтому cron каждые 15 мин:
  // запрос дешёвый и в лимит 3 req/min укладывается с запасом. Чаще смысла нет —
  // данные Воронки у WB обновляются ~раз в час. Финализация за вчера и сверка
  // истории — на отдельных CSV-кронах, это не про сегодня.
  wbOrdersSyncCron: getOptionalEnv("WB_ORDERS_SYNC_CRON", "0 */15 * * * *").trim() || "0 */15 * * * *",
  // Финализация заказов за вчера через CSV. Дефолт — 02:00 МСК: к этому
  // моменту WB сбросил дневной лимит Analytics API (20 отчётов/сутки),
  // поэтому 429 нам не грозит. Сервер живёт по Europe/Moscow, и cron
  // интерпретируется в местном времени → cron-строка тоже в МСК.
  wbOrdersFinalizeCron: getOptionalEnv("WB_ORDERS_FINALIZE_CRON", "0 0 2 * * *").trim() || "0 0 2 * * *",
  // Ночная сверка заказов/выкупов с CSV: тянем КОРОТКИЙ отчёт за последние N дней,
  // а не годовой. WB доуточняет день ~2 недели, поэтому 30 дней с запасом покрывают
  // «дозревающее» окно; короткий отчёт генерится за секунды и почти не ловит 429.
  wbOrdersReconcileDays: parsePositiveIntegerEnv("WB_ORDERS_RECONCILE_DAYS", "30", 1),
  // Stocks snapshot: once per day at 01:00 MSK. Server runs in Europe/Moscow, so the cron
  // string IS Moscow time, NOT UTC — the old "0 0 22 * * *" with a «22:00 UTC = 01:00 МСК»
  // note actually fired at 22:00 MSK. Downloads /api/v1/supplier/stocks, stores qty per nmId.
  wbStocksSnapshotEnabled: parseBooleanEnv("WB_STOCKS_SNAPSHOT_ENABLED", "true"),
  wbStocksSnapshotCron: getOptionalEnv("WB_STOCKS_SNAPSHOT_CRON", "0 0 1 * * *").trim() || "0 0 1 * * *",
  wbClustersWriteApiKey: (process.env.WB_CLUSTERS_WRITE_API_KEY ?? "").trim(),
  wbPromotionApiBaseUrl: getOptionalUrlEnv(
    "WB_PROMOTION_API_BASE_URL",
    "https://advert-api.wildberries.ru",
  ),
  wbPromotionApiTimeoutMs: parsePositiveIntegerEnv(
    "WB_PROMOTION_API_TIMEOUT_MS",
    "45000",
    1,
  ),
  // Default lane: /adv/v1/promotion/count, /adv/v0/normquery/list and other general
  // Promotion API endpoints. WB allows ~5 req/sec → 200 ms is the safe floor.
  wbPromotionApiMinIntervalMs: parsePositiveIntegerEnv(
    "WB_PROMOTION_API_MIN_INTERVAL_MS",
    "200",
  ),
  wbPromotionBidWriteMinIntervalMs: parsePositiveIntegerEnv(
    "WB_PROMOTION_BID_WRITE_MIN_INTERVAL_MS",
    "700",
  ),
  wbPromotionBidReadMinIntervalMs: parsePositiveIntegerEnv(
    "WB_PROMOTION_BID_READ_MIN_INTERVAL_MS",
    "220",
  ),
  wbPromotionMinusWriteMinIntervalMs: parsePositiveIntegerEnv(
    "WB_PROMOTION_MINUS_WRITE_MIN_INTERVAL_MS",
    "200",
  ),
  wbPromotionMinusReadMinIntervalMs: parsePositiveIntegerEnv(
    "WB_PROMOTION_MINUS_READ_MIN_INTERVAL_MS",
    "200",
  ),
  // /api/advert/v2/adverts accepts up to 50 IDs per request and allows ~5 req/sec.
  // 400 ms gives a safe 2.5 req/sec buffer; bump chunk size to 50 to halve the
  // number of round-trips needed for the inventory phase.
  wbPromotionDetailsMinIntervalMs: parsePositiveIntegerEnv(
    "WB_PROMOTION_DETAILS_MIN_INTERVAL_MS",
    "400",
  ),
  wbPromotionDetailsChunkSize: parsePositiveIntegerEnv(
    "WB_PROMOTION_DETAILS_CHUNK_SIZE",
    "50",
    1,
  ),
  // WB enforces a hard 1 req/6 s limit on normquery/stats endpoints.
  // Do NOT reduce below ~6100 ms or 429s will cause 60 s cooldown penalties.
  wbPromotionStatsMinIntervalMs: parsePositiveIntegerEnv(
    "WB_PROMOTION_STATS_MIN_INTERVAL_MS",
    "6500",
  ),
  // GET /adv/v3/fullstats (полный расход кампании, как в кабинете). Лимит WB —
  // ~200 запросов/сутки на аккаунт; держим минутный интервал как страховку от 429.
  // Число запросов снижаем pre-фильтром /adv/v1/upd (только реально тратившие РК).
  wbPromotionFullstatsMinIntervalMs: parsePositiveIntegerEnv(
    "WB_PROMOTION_FULLSTATS_MIN_INTERVAL_MS",
    "60000",
  ),
  // Сколько advertId (ids через запятую) за один GET /adv/v3/fullstats.
  // WB ограничивает 50 кампаний на запрос ("number of advert cannot be more than 50").
  wbPromotionFullstatsChunkSize: parsePositiveIntegerEnv(
    "WB_PROMOTION_FULLSTATS_CHUNK_SIZE",
    "50",
    1,
  ),
  // Часовой крон полного расхода рекламы (в начале каждого часа МСК). Pre-фильтр
  // /adv/v1/upd оставляет лишь тративших РК (~80 из ~1000) → ~1 upd + 2 fullstats
  // на прогон = ~72 запроса/сутки, с большим запасом под лимит WB (~200).
  wbPromotionFullstatsSyncCron:
    getOptionalEnv("WB_PROMOTION_FULLSTATS_SYNC_CRON", "0 0 * * * *").trim() ||
    "0 0 * * * *",
  wbPromotionRetryAttempts: parsePositiveIntegerEnv(
    "WB_PROMOTION_RETRY_ATTEMPTS",
    "2",
  ),
  wbPromotionRetryBaseDelayMs: parsePositiveIntegerEnv(
    "WB_PROMOTION_RETRY_BASE_DELAY_MS",
    "15000",
  ),
  wbPromotionApiToken: (process.env.WB_PROMOTION_API_TOKEN ?? "").trim(),
  wbPromotionStatsLookbackDays: parsePositiveIntegerEnv(
    "WB_PROMOTION_STATS_LOOKBACK_DAYS",
    "30",
    1,
  ),
  // Ночной precompute пропускает товары, у которых строк query-universe
  // (wb_cabinet_cluster_queries) больше порога: сборка такого «монстра» тянет все
  // строки в JS и пробивает heap-лимит → FATAL OOM роняет весь бэкенд. Такие товары
  // материализуются on-demand (по одному) при открытии. Тюнится без передеплоя кода.
  wbPrecomputeMaxQueryRows: parsePositiveIntegerEnv(
    "WB_PRECOMPUTE_MAX_QUERY_ROWS",
    "80000",
    1,
  ),
  // Защита сборки рекламного листа от heap OOM: если строк query-universe товара
  // больше порога, тяжёлая загрузка (216k строк в JS) ПРОПУСКАЕТСЯ — лист строится с
  // пустыми clusterQueries (первый экран фронта их не использует: он идёт из лёгких
  // /workspace + /workspace-cluster-table). Закрывает OOM и в precompute, и on-demand.
  wbSheetBuildMaxQueryRows: parsePositiveIntegerEnv(
    "WB_SHEET_BUILD_MAX_QUERY_ROWS",
    "80000",
    1,
  ),
  wbPromotionSyncEnabled: parseBooleanEnv("WB_PROMOTION_SYNC_ENABLED", "true"),
  wbPromotionSyncCron:
    getOptionalEnv("WB_PROMOTION_SYNC_CRON", "*/10 * * * *").trim() ||
    "*/10 * * * *",
  wbPromotionRawArchiveBatchSize: parsePositiveIntegerEnv(
    "WB_PROMOTION_RAW_ARCHIVE_BATCH_SIZE",
    "16",
    1,
  ),
  wbPromotionEnableCmpInFullSync: parseBooleanEnv(
    "WB_PROMOTION_ENABLE_CMP_IN_FULL_SYNC",
    "true",
  ),
  wbPromotionEnableMonthlyFrequencyInFullSync: parseBooleanEnv(
    "WB_PROMOTION_ENABLE_MONTHLY_FREQUENCY_IN_FULL_SYNC",
    "true",
  ),
  wbPromotionMonthlyFrequencySyncCron:
    getOptionalEnv("WB_PROMOTION_MONTHLY_FREQUENCY_SYNC_CRON", "0 4 * * 0").trim() ||
    "0 4 * * 0",
  // Automatic JAM inside ordinary full sync is disabled by default so the
  // shared search-texts quota is not consumed by background promotion refreshes.
  // Historical backfill and yesterday finalization stay on the dedicated JAM cron
  // and on explicit manual backfill calls.
  wbPromotionEnableJamInFullSync: parseBooleanEnv(
    "WB_PROMOTION_ENABLE_JAM_IN_FULL_SYNC",
    "false",
  ),
  wbPromotionJamSyncEnabled: parseBooleanEnv("WB_PROMOTION_JAM_SYNC_ENABLED", "true"),
  // Boot-time JAM backfill is disabled by default. This prevents PM2 restarts
  // and deploys from immediately spending the shared WB search-texts quota.
  // Historical catch-up stays available via the nightly JAM cron and explicit
  // manual backfill requests.
  wbPromotionJamBackfillLoopEnabled: parseBooleanEnv(
    "WB_PROMOTION_JAM_BACKFILL_LOOP_ENABLED",
    "false",
  ),
  // Runs once a day at 03:00 UTC (06:00 MSK) to finalize the previous day's JAM
  // search-text snapshots for all known nmIds.  By 06:00 MSK WB's API returns
  // fully closed daily numbers for the previous calendar day.
  // Historical per-day snapshots are never deleted — they accumulate in
  // wb_product_search_text_range_snapshots for any-range historical analysis.
  wbPromotionJamSyncCron:
    getOptionalEnv("WB_PROMOTION_JAM_SYNC_CRON", "0 3 * * *").trim() ||
    "0 3 * * *",
  wbCabinetEnabled: parseBooleanEnv("WB_CABINET_ENABLED", "false"),
  wbCabinetCmpBaseUrl: getOptionalUrlEnv(
    "WB_CABINET_CMP_BASE_URL",
    "https://cmp.wildberries.ru",
  ),
  wbCabinetHeadless: parseBooleanEnv("WB_CABINET_HEADLESS", "true"),
  wbCabinetStorageStatePath:
    getOptionalNullablePathEnv("WB_CABINET_STORAGE_STATE_PATH") ??
    path.resolve(
      path.basename(process.cwd()) === "backend"
        ? path.join(process.cwd(), "data", "wb-cabinet-storage-state.json")
        : path.join(process.cwd(), "backend", "data", "wb-cabinet-storage-state.json"),
    ),
  wbCabinetExecutablePath: getOptionalNullablePathEnv(
    "WB_CABINET_EXECUTABLE_PATH",
  ),
  wbCabinetRequestTimeoutMs: parsePositiveIntegerEnv(
    "WB_CABINET_REQUEST_TIMEOUT_MS",
    "60000",
    1,
  ),
  wbCabinetProbeMaxRequests: parsePositiveIntegerEnv(
    "WB_CABINET_PROBE_MAX_REQUESTS",
    "60",
    1,
  ),
  wbCabinetEnableInFullSync: parseBooleanEnv(
    "WB_CABINET_ENABLE_IN_FULL_SYNC",
    "true",
  ),
  wbArchiveRoot: getOptionalPathEnv(
    "WB_ARCHIVE_ROOT",
    path.resolve(
      path.basename(process.cwd()) === "backend"
        ? path.join(process.cwd(), "data", "search-queries")
        : path.join(process.cwd(), "backend", "data", "search-queries"),
    ),
  ),
  postgres: resolvePostgresConfig(),
};
