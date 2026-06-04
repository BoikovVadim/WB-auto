/**
 * Гарантирует живую WB-сессию для headless-выгрузок (login-on-demand).
 *   1) headless-проверка живости нужной цели → жива, выходим;
 *   2) иначе открываем ВИДИМОЕ окно, ждём (поллинг), как только цель ожила —
 *      сохраняем storageState и закрываем. macOS-баннер «нужен вход».
 *
 * Две цели (`target`), т.к. это РАЗНЫЕ сессии WB:
 *   - 'content-analytics' (seller.wildberries.ru) — для выгрузки частот;
 *   - 'cmp' (cmp.wildberries.ru) — для карты запросов кластеров.
 * Открыв login-окно на нужном домене, после ручного входа WB сам редиректит
 * обратно на целевой портал, и сессия захватывается.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { chromium, type BrowserContext, type LaunchOptions, type Page } from "playwright";

import { macNotify } from "./mac-notify";
import { buildListUrl, type ContentAnalyticsReportType } from "./wb-content-analytics-api.client";

export type WbSessionTarget = "content-analytics" | "cmp";

const SELLER_PORTAL_URL = "https://seller.wildberries.ru/search-analytics/popular-search-queries";
const CMP_LIST_URL = "https://cmp.wildberries.ru/campaigns/list/all";

const TARGET_URL: Record<WbSessionTarget, string> = {
  "content-analytics": SELLER_PORTAL_URL,
  cmp: CMP_LIST_URL,
};

/** Проверка живости цели на уже навигированной странице (in-page, без редиректов). */
async function probeAlive(
  page: Page,
  target: WbSessionTarget,
  reportType: ContentAnalyticsReportType,
): Promise<boolean> {
  if (target === "cmp") {
    const s = await page
      .evaluate(() => {
        type G = { location: { host: string }; localStorage: { getItem(k: string): string | null } };
        const g = globalThis as unknown as G;
        return { host: g.location.host, tokenLen: (g.localStorage.getItem("access-token") || "").length };
      })
      .catch(() => ({ host: "", tokenLen: 0 }));
    return s.host.includes("cmp.wildberries.ru") && s.tokenLen > 0;
  }
  const status = await page
    .evaluate(async (url) => {
      type G = {
        localStorage: { getItem(key: string): string | null };
        fetch: (url: string, init: { method: string; credentials: string; headers: Record<string, string> }) => Promise<{ status: number }>;
      };
      const g = globalThis as unknown as G;
      try {
        const av3 = g.localStorage.getItem("wb-eu-passport-v2.access-token") || "";
        const r = await g.fetch(url, { method: "GET", credentials: "include", headers: { AuthorizeV3: av3, Accept: "application/json" } });
        return r.status;
      } catch {
        return 0;
      }
    }, buildListUrl(reportType))
    .catch(() => 0);
  return status === 200;
}

/** Навигирует на целевой портал и ждёт живости (cmp-токен приходит асинхронно). */
async function navigateAndWaitAlive(
  page: Page,
  target: WbSessionTarget,
  reportType: ContentAnalyticsReportType,
  attempts: number,
): Promise<boolean> {
  await page.goto(TARGET_URL[target], { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
  for (let i = 0; i < attempts; i += 1) {
    if (await probeAlive(page, target, reportType)) return true;
    await page.waitForTimeout(1500);
  }
  return false;
}

export async function ensureWbSession(opts: {
  storageStatePath: string;
  target?: WbSessionTarget;
  executablePath?: string;
  reportType?: ContentAnalyticsReportType;
  /** Сколько ждать вход в видимом окне (по умолчанию 30 мин). */
  maxWaitMs?: number;
  /** Принудительно открыть окно входа даже при живой сессии (ручной захват). */
  forceLogin?: boolean;
  log?: (message: string) => void;
}): Promise<"already-live" | "captured"> {
  const target = opts.target ?? "content-analytics";
  const reportType = opts.reportType ?? "SEARCH_ANALYSIS_PREMIUM_REPORT";
  const maxWaitMs = opts.maxWaitMs ?? 30 * 60_000;
  const log = opts.log ?? (() => undefined);
  const baseLaunch: LaunchOptions = {};
  if (opts.executablePath) baseLaunch.executablePath = opts.executablePath;

  // 1) Быстрая headless-проверка (для cmp токен подтягивается чуть дольше).
  if (!opts.forceLogin && existsSync(opts.storageStatePath)) {
    const browser = await chromium.launch({ ...baseLaunch, headless: true });
    try {
      const context = await browser.newContext({ storageState: opts.storageStatePath });
      const page = await context.newPage();
      // cmp: живая cookie отдаёт токен за пару секунд; протухшая — редирект на
      // auth навсегда (silent-SSO не проходит headless), 8 попыток хватает отличить.
      if (await navigateAndWaitAlive(page, target, reportType, target === "cmp" ? 8 : 1)) {
        log(`Сессия жива (${target}, headless).`);
        return "already-live";
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  // 2) Login-on-demand: видимое окно входа на целевом домене.
  macNotify("WB: нужен вход", `Открыл окно (${target}). Залогинься — дальше сам.`);
  log(`Сессия не живая (${target}) — открываю окно для входа.`);
  const browser = await chromium.launch({ ...baseLaunch, headless: false });
  try {
    const context: BrowserContext = existsSync(opts.storageStatePath)
      ? await browser.newContext({ storageState: opts.storageStatePath })
      : await browser.newContext();
    const page = await context.newPage();
    await page.goto(TARGET_URL[target], { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);

    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      if (await probeAlive(page, target, reportType)) {
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
      await page.waitForTimeout(5_000);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}
