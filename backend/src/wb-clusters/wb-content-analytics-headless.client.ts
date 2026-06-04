/**
 * Headless-клиент content-analytics WB (фоновая выгрузка частот без Safari).
 *
 * Авторизация content-analytics держится на httpOnly-cookies, видимых только
 * браузерному контексту. Поэтому всё идёт через headless-Chromium (Playwright) с
 * сохранённым storageState (захват — wb-session-capture.ts):
 *   - create/list отчёта — in-page fetch (credentials:include шлёт httpOnly-куки);
 *   - скачивание файла   — anchor-click по downloadUrl + waitForEvent('download')
 *     (download-домен может не отдавать CORS на fetch, как и у портала).
 *
 * Никакого видимого окна и тротлинга скрытой вкладки → выгрузка полная.
 */
import { Logger } from "@nestjs/common";
import { chromium, type BrowserContext, type LaunchOptions, type Page } from "playwright";

import {
  buildCreateReportBody,
  buildListUrl,
  generateReportId,
  WB_CONTENT_ANALYTICS_CREATE_URL,
  type ContentAnalyticsDownloadEntry,
  type ContentAnalyticsListResponse,
  type ContentAnalyticsReportType,
} from "./wb-content-analytics-api.client";

const SELLER_PORTAL_URL = "https://seller.wildberries.ru/search-analytics/popular-search-queries";
const WB_CONTENT_ANALYTICS_TOKENS_URL =
  "https://seller-content.wildberries.ru/ns/suppliers-auth-tokens/suppliers-portal-core/api/v1/tokensjrpc";

/** Форма браузерных глобалей для in-page fetch (DOM-типов в node-tsconfig нет; без any). */
type BrowserFetchGlobals = {
  localStorage: { getItem(key: string): string | null };
  fetch: (
    url: string,
    init: { method: string; credentials: string; headers: Record<string, string>; body?: string },
  ) => Promise<{
    status: number;
    ok: boolean;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  btoa: (data: string) => string;
};

export interface HeadlessCaOptions {
  storageStatePath: string;
  headless: boolean;
  executablePath?: string;
  pageLoadTimeoutMs?: number;
  downloadTimeoutMs?: number;
  reportPollIntervalMs?: number;
  reportPollTimeoutMs?: number;
}

export class WbContentAnalyticsHeadlessClient {
  private readonly logger = new Logger(WbContentAnalyticsHeadlessClient.name);
  private readonly pageLoadTimeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly reportPollIntervalMs: number;
  private readonly reportPollTimeoutMs: number;

  constructor(private readonly options: HeadlessCaOptions) {
    this.pageLoadTimeoutMs = options.pageLoadTimeoutMs ?? 60_000;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? 180_000;
    this.reportPollIntervalMs = options.reportPollIntervalMs ?? 2_000;
    this.reportPollTimeoutMs = options.reportPollTimeoutMs ?? 12 * 60_000;
  }

  /** Открывает headless-контекст с сохранённой сессией и отдаёт страницу портала. */
  private async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const launchOptions: LaunchOptions = { headless: this.options.headless };
    if (this.options.executablePath) launchOptions.executablePath = this.options.executablePath;

    const browser = await chromium.launch(launchOptions);
    let context: BrowserContext | null = null;
    try {
      context = await browser.newContext({ storageState: this.options.storageStatePath });
      const page = await context.newPage();
      await page.goto(SELLER_PORTAL_URL, {
        waitUntil: "domcontentloaded",
        timeout: this.pageLoadTimeoutMs,
      });
      // Дать SPA дорендериться (панель загрузок появляется не сразу) — как в free-клиенте.
      await page.waitForLoadState("networkidle", { timeout: this.pageLoadTimeoutMs }).catch(() => undefined);
      await page.waitForTimeout(3000);
      return await fn(page);
    } finally {
      await context?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  /** In-page fetch к content-analytics (шлёт httpOnly-куки). Возвращает status+body. */
  private async caFetch(
    page: Page,
    method: "GET" | "POST",
    url: string,
    body?: string,
  ): Promise<{ status: number; body: string }> {
    return page.evaluate(
      async ({ method, url, body }) => {
        const g = globalThis as unknown as BrowserFetchGlobals;
        const av3 = g.localStorage.getItem("wb-eu-passport-v2.access-token") || "";
        const headers: Record<string, string> = { AuthorizeV3: av3, Accept: "application/json" };
        if (method === "POST") headers["Content-Type"] = "application/json";
        const response = await g.fetch(url, {
          method,
          credentials: "include",
          headers,
          ...(body ? { body } : {}),
        });
        return { status: response.status, body: await response.text() };
      },
      { method, url, body },
    );
  }

  /** Проверка живой сессии: list возвращает 200. */
  async isSessionLive(page: Page, reportType: ContentAnalyticsReportType): Promise<boolean> {
    const result = await this.caFetch(page, "GET", buildListUrl(reportType)).catch(() => ({
      status: 0,
      body: "",
    }));
    return result.status === 200;
  }

  private parseList(body: string): ContentAnalyticsDownloadEntry[] {
    const parsed = JSON.parse(body) as ContentAnalyticsListResponse;
    return parsed.data?.downloads ?? [];
  }

  /** Создаёт отчёт, дожидается SUCCESS, скачивает ZIP — на ПЕРЕДАННОЙ странице (для session-режима). */
  private async createAndDownloadOnPage(
    page: Page,
    input: { reportType: ContentAnalyticsReportType; subjectIds?: number[]; orderByMode?: "asc" | "desc" },
  ): Promise<{ buffer: Buffer; fileName: string; entry: ContentAnalyticsDownloadEntry }> {
    const reportId = generateReportId();
    const createBody = buildCreateReportBody({
      reportId,
      reportType: input.reportType,
      subjectIds: input.subjectIds,
      orderByMode: input.orderByMode,
    });
    const created = await this.caFetch(page, "POST", WB_CONTENT_ANALYTICS_CREATE_URL, createBody);
    if (created.status < 200 || created.status >= 300) {
      throw new Error(`Создание отчёта вернуло HTTP ${created.status}: ${created.body.slice(0, 200)}`);
    }
    const entry = await this.pollUntilSuccess(page, input.reportType, reportId);
    const { buffer, fileName } = await this.downloadEntry(page, entry);
    return { buffer, fileName, entry };
  }

  /** Создаёт отчёт, дожидается SUCCESS, скачивает ZIP, возвращает его буфер (своё окно). */
  async createAndDownloadReport(input: {
    reportType: ContentAnalyticsReportType;
    subjectIds?: number[];
    orderByMode?: "asc" | "desc";
  }): Promise<{ buffer: Buffer; fileName: string; entry: ContentAnalyticsDownloadEntry }> {
    return this.withPage(async (page) => {
      if (!(await this.isSessionLive(page, input.reportType))) {
        throw new Error("WB-сессия не живая (list != 200). Перезапусти wb-session-capture.ts.");
      }
      return this.createAndDownloadOnPage(page, input);
    });
  }

  /**
   * Session-режим: одно окно/контекст на множество отчётов (для импорта по категориям).
   * Проверяет сессию один раз, затем отдаёт API создания+скачивания на общей странице.
   */
  async runImportSession<T>(
    reportType: ContentAnalyticsReportType,
    fn: (session: {
      createAndDownload: (
        subjectIds: number[],
        orderByMode: "asc" | "desc",
      ) => Promise<{ buffer: Buffer; fileName: string; entry: ContentAnalyticsDownloadEntry }>;
    }) => Promise<T>,
  ): Promise<T> {
    return this.withPage(async (page) => {
      if (!(await this.isSessionLive(page, reportType))) {
        throw new Error("WB-сессия не живая (list != 200). Перезапусти захват сессии (wb-session-capture.ts).");
      }
      return fn({
        createAndDownload: (subjectIds, orderByMode) =>
          this.createAndDownloadOnPage(page, { reportType, subjectIds, orderByMode }),
      });
    });
  }

  /** Последняя готовая (SUCCESS) запись без скачивания — для диагностики downloadUrl. */
  async latestSuccessEntry(
    reportType: ContentAnalyticsReportType,
  ): Promise<ContentAnalyticsDownloadEntry | null> {
    return this.withPage(async (page) => {
      const listed = await this.caFetch(page, "GET", buildListUrl(reportType));
      if (listed.status !== 200) {
        throw new Error(`list вернул HTTP ${listed.status}. Перезапусти wb-session-capture.ts.`);
      }
      return (
        this.parseList(listed.body)
          .filter((item) => item.status === "SUCCESS")
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null
      );
    });
  }

  /** Скачивает последний готовый (SUCCESS) отчёт без создания нового — для проверки пути. */
  async downloadLatestSuccessReport(
    reportType: ContentAnalyticsReportType,
  ): Promise<{ buffer: Buffer; fileName: string; entry: ContentAnalyticsDownloadEntry }> {
    return this.withPage(async (page) => {
      const listed = await this.caFetch(page, "GET", buildListUrl(reportType));
      if (listed.status !== 200) {
        throw new Error(`list вернул HTTP ${listed.status}. Перезапусти wb-session-capture.ts.`);
      }
      const entry = this.parseList(listed.body)
        .filter((item) => item.status === "SUCCESS")
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      if (!entry) throw new Error("Нет готовых (SUCCESS) отчётов для скачивания.");
      const { buffer, fileName } = await this.downloadEntry(page, entry);
      return { buffer, fileName, entry };
    });
  }

  /** Поллит list, пока нужный reportId не станет SUCCESS (или FAILED/таймаут). */
  private async pollUntilSuccess(
    page: Page,
    reportType: ContentAnalyticsReportType,
    reportId: string,
  ): Promise<ContentAnalyticsDownloadEntry> {
    const deadline = Date.now() + this.reportPollTimeoutMs;
    for (;;) {
      const listed = await this.caFetch(page, "GET", buildListUrl(reportType));
      if (listed.status === 200) {
        const entry = this.parseList(listed.body).find((item) => item.id === reportId);
        if (entry?.status === "SUCCESS") return entry;
        if (entry?.status === "FAILED") {
          throw new Error(`Отчёт ${reportId} завершился со статусом FAILED.`);
        }
      }
      if (Date.now() > deadline) {
        throw new Error(`Отчёт ${reportId} не стал SUCCESS за ${this.reportPollTimeoutMs / 60000} мин.`);
      }
      await page.waitForTimeout(this.reportPollIntervalMs);
    }
  }

  /**
   * Выпускает одноразовый x-download-token: POST tokensjrpc (generateToken,
   * team=content-analytics) с AuthorizeV3. Именно этим токеном (не AuthorizeV3)
   * авторизуется download-домен — выяснено перехватом реального запроса портала.
   */
  private async mintDownloadToken(page: Page): Promise<string> {
    const body = JSON.stringify({
      method: "generateToken",
      params: { team: "content-analytics" },
      jsonrpc: "2.0",
      id: "json-rpc_1",
    });
    const res = await this.caFetch(page, "POST", WB_CONTENT_ANALYTICS_TOKENS_URL, body);
    if (res.status !== 200) {
      throw new Error(`tokensjrpc вернул HTTP ${res.status}: ${res.body.slice(0, 200)}`);
    }
    const parsed = JSON.parse(res.body) as { result?: { token?: string } };
    const token = parsed.result?.token;
    if (!token) throw new Error("tokensjrpc не вернул result.token.");
    return token;
  }

  /**
   * Скачивает файл записи: выпускает x-download-token и тянет файл через Playwright
   * APIRequestContext с этим заголовком (шлёт куки контекста, не подчиняется CORS).
   * Никаких кликов/окон/download-событий.
   */
  private async downloadEntry(
    page: Page,
    entry: ContentAnalyticsDownloadEntry,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const downloadToken = await this.mintDownloadToken(page);
    const response = await page.context().request.get(entry.downloadUrl, {
      headers: {
        "x-download-token": downloadToken,
        Referer: "https://seller.wildberries.ru/",
        Origin: "https://seller.wildberries.ru",
      },
      timeout: this.downloadTimeoutMs,
    });
    if (!response.ok()) {
      throw new Error(`Скачивание downloadUrl вернуло HTTP ${response.status()}.`);
    }
    const buffer = await response.body();
    const fileName = entry.name || `${entry.id}.zip`;
    this.logger.log(`Headless download: "${fileName}" (${buffer.length} bytes).`);
    return { buffer, fileName };
  }
}
