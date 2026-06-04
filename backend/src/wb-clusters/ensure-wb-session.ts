/**
 * Гарантирует живую WB-сессию для headless-выгрузок (login-on-demand).
 *   1) headless-проверка: list content-analytics == 200 → сессия жива, выходим;
 *   2) иначе открываем ВИДИМОЕ окно входа, ждём (поллинг), как только list==200 —
 *      сохраняем storageState и закрываем. macOS-баннер «нужен вход».
 * Используется и раннером импорта, и ручным захватом (wb-session-capture.ts).
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { chromium, type BrowserContext, type LaunchOptions } from "playwright";

import { macNotify } from "./mac-notify";
import { buildListUrl, type ContentAnalyticsReportType } from "./wb-content-analytics-api.client";

const SELLER_PORTAL_URL = "https://seller.wildberries.ru/search-analytics/popular-search-queries";

/** In-page fetch к content-analytics list — шлёт httpOnly-куки. true при HTTP 200. */
async function isSessionLive(
  context: BrowserContext,
  reportType: ContentAnalyticsReportType,
): Promise<boolean> {
  const page = context.pages()[0] ?? (await context.newPage());
  const status = await page
    .evaluate(async (url) => {
      type Globals = {
        localStorage: { getItem(key: string): string | null };
        fetch: (
          url: string,
          init: { method: string; credentials: string; headers: Record<string, string> },
        ) => Promise<{ status: number }>;
      };
      const g = globalThis as unknown as Globals;
      try {
        const av3 = g.localStorage.getItem("wb-eu-passport-v2.access-token") || "";
        const r = await g.fetch(url, {
          method: "GET",
          credentials: "include",
          headers: { AuthorizeV3: av3, Accept: "application/json" },
        });
        return r.status;
      } catch {
        return 0;
      }
    }, buildListUrl(reportType))
    .catch(() => 0);
  return status === 200;
}

export async function ensureWbSession(opts: {
  storageStatePath: string;
  executablePath?: string;
  reportType?: ContentAnalyticsReportType;
  /** Сколько ждать вход в видимом окне (по умолчанию 30 мин). */
  maxWaitMs?: number;
  /** Принудительно открыть окно входа даже при живой сессии (ручной захват). */
  forceLogin?: boolean;
  log?: (message: string) => void;
}): Promise<"already-live" | "captured"> {
  const reportType = opts.reportType ?? "SEARCH_ANALYSIS_PREMIUM_REPORT";
  const maxWaitMs = opts.maxWaitMs ?? 30 * 60_000;
  const log = opts.log ?? (() => undefined);
  const baseLaunch: LaunchOptions = {};
  if (opts.executablePath) baseLaunch.executablePath = opts.executablePath;

  // 1) Быстрая headless-проверка живой сессии.
  if (!opts.forceLogin && existsSync(opts.storageStatePath)) {
    const browser = await chromium.launch({ ...baseLaunch, headless: true });
    try {
      const context = await browser.newContext({ storageState: opts.storageStatePath });
      const page = await context.newPage();
      await page.goto(SELLER_PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
      if (await isSessionLive(context, reportType)) {
        log("Сессия жива (headless).");
        return "already-live";
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  // 2) Login-on-demand: видимое окно входа.
  macNotify("WB: нужен вход", "Открыл окно. Залогинься на seller.wildberries.ru — дальше сам.");
  log("Сессия не живая — открываю окно для входа.");
  const browser = await chromium.launch({ ...baseLaunch, headless: false });
  try {
    const context = existsSync(opts.storageStatePath)
      ? await browser.newContext({ storageState: opts.storageStatePath })
      : await browser.newContext();
    const page = await context.newPage();
    await page.goto(SELLER_PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);

    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      if (await isSessionLive(context, reportType)) {
        mkdirSync(path.dirname(opts.storageStatePath), { recursive: true });
        await context.storageState({ path: opts.storageStatePath });
        macNotify("WB сессия", "Вход выполнен — продолжаю в фоне.");
        log("Вход выполнен, сессия сохранена.");
        return "captured";
      }
      if (Date.now() > deadline) {
        macNotify("WB: вход не выполнен", "За отведённое время вход не сделан.");
        throw new Error("Таймаут ожидания входа — сессия не захвачена.");
      }
      await page.waitForTimeout(15_000);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}
