import { Injectable, Logger } from "@nestjs/common";

/**
 * Зонд места товара в публичной поисковой выдаче WB (search.wb.ru).
 *
 * Снаружи это «ввели запрос → нашли наш товар по ID → отдали место», но под капотом —
 * лёгкий JSON-запрос к API выдачи, а НЕ загрузка тяжёлой веб-страницы (дешевле/быстрее).
 *
 * Нюансы WB, которые здесь учтены:
 *  - Двухшаговый preset: на популярный запрос WB отдаёт не товары, а metadata с
 *    catalog_type=preset; товары добираем вторым вызовом с тем же query + &preset=<id>.
 *    Метадата приходит с битым хвостом (не парсится JSON) — preset достаём regex'ом.
 *  - Анти-бот по IP: на нагрузке прилетает HTTP 429 (на 1 чистый IP держится только
 *    щадящий темп). 429 возвращаем статусом throttled — оркестратор делает backoff.
 *  - Реклама: у буст-карточки есть поле log (рекламный слот). Различаем органическую
 *    позицию (порядок карточки в выдаче) и рекламную (log.position).
 *
 * v1 ходит с IP прод-сервера напрямую (без прокси). Гео фиксируем dest=Москва — место
 * воспроизводимо независимо от того, откуда физически идёт запрос.
 */

const SEARCH_BASE = "https://search.wb.ru/exactmatch/ru/common/v13/search";
const DEST_MOSCOW = "-1257786";
const PROBE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36";

export type PositionProbeStatus =
  | "found"
  | "not_found"
  | "throttled"
  | "blocked"
  | "error";

export interface PositionProbeResult {
  status: PositionProbeStatus;
  /** Порядковый номер карточки в выдаче (что видит покупатель), 1-based. */
  organicPosition: number | null;
  /** Рекламный слот, если карточка стоит как буст (поле log в ответе WB). */
  adPosition: number | null;
  isAd: boolean;
  /** Страница выдачи, на которой нашли товар. */
  page: number | null;
  /** Сколько карточек просмотрели (глубина «не в топ-N»). */
  scanned: number;
}

export interface PositionProbeOptions {
  /** Максимум страниц выдачи (по ~100 карточек). По умолчанию топ-300. */
  maxPages?: number;
  dest?: string;
  /** Пауза между страницами одного кластера, мс. */
  pageDelayMs?: number;
  /** Таймаут одного HTTP-запроса, мс. */
  timeoutMs?: number;
}

interface WbSearchProduct {
  id: number;
  log?: { position?: number | null } | null;
}

interface FetchPageResult {
  httpStatus: number;
  products: WbSearchProduct[] | null;
  presetId: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class WbSearchPositionProbeClient {
  private readonly logger = new Logger(WbSearchPositionProbeClient.name);

  private buildUrl(query: string, page: number, dest: string, presetId: string | null) {
    const params = new URLSearchParams({
      ab_testing: "false",
      appType: "1",
      curr: "rub",
      dest,
      hide_dtype: "13",
      lang: "ru",
      page: String(page),
      resultset: "catalog",
      sort: "popular",
      spp: "30",
      suppressSpellcheck: "false",
      query,
    });
    if (presetId) params.set("preset", presetId);
    return `${SEARCH_BASE}?${params.toString()}`;
  }

  private async fetchPage(
    query: string,
    page: number,
    dest: string,
    presetId: string | null,
    timeoutMs: number,
  ): Promise<FetchPageResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(this.buildUrl(query, page, dest, presetId), {
        headers: {
          Accept: "*/*",
          "Accept-Encoding": "gzip, deflate, br",
          Origin: "https://www.wildberries.ru",
          Referer: "https://www.wildberries.ru/",
          "User-Agent": PROBE_UA,
        },
        signal: controller.signal,
      });
      if (res.status === 429) {
        await res.text().catch(() => undefined);
        return { httpStatus: 429, products: null, presetId: null };
      }
      const raw = await res.text();
      // Товары приходят валидным JSON; metadata preset — с битым хвостом (не парсится).
      try {
        const json = JSON.parse(raw) as { data?: { products?: WbSearchProduct[] } };
        const products = json.data?.products;
        if (Array.isArray(products)) {
          return { httpStatus: res.status, products, presetId: null };
        }
      } catch {
        // не JSON — ниже пробуем достать preset
      }
      const m = raw.match(/"catalog_value":"preset=(\d+)/);
      return { httpStatus: res.status, products: null, presetId: m ? m[1]! : null };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Найти место nm_id в выдаче по одному запросу. Шаг 1 — обычный поиск; если ушло в
   * preset — шаг 2 с тем же query и &preset=<id>. Дальше листаем до maxPages, ищем nm_id.
   */
  async probeQueryPosition(
    query: string,
    nmId: number,
    options: PositionProbeOptions = {},
  ): Promise<PositionProbeResult> {
    const maxPages = options.maxPages ?? 3;
    const dest = options.dest ?? DEST_MOSCOW;
    const pageDelayMs = options.pageDelayMs ?? 1500;
    const timeoutMs = options.timeoutMs ?? 25_000;

    const notFound: PositionProbeResult = {
      status: "not_found",
      organicPosition: null,
      adPosition: null,
      isAd: false,
      page: null,
      scanned: 0,
    };

    try {
      // Шаг 1 — определяем, inline-товары или preset.
      let first = await this.fetchPage(query, 1, dest, null, timeoutMs);
      if (first.httpStatus === 429) return { ...notFound, status: "throttled" };
      let presetId: string | null = null;
      if (!first.products) {
        if (!first.presetId) return { ...notFound, status: "blocked" };
        presetId = first.presetId;
        await sleep(pageDelayMs);
        first = await this.fetchPage(query, 1, dest, presetId, timeoutMs);
        if (first.httpStatus === 429) return { ...notFound, status: "throttled" };
        if (!first.products) return { ...notFound, status: "blocked" };
      }

      let rank = 0;
      for (let page = 1; page <= maxPages; page++) {
        const pageResult =
          page === 1
            ? first
            : await this.fetchPage(query, page, dest, presetId, timeoutMs);
        if (page > 1) {
          if (pageResult.httpStatus === 429)
            return { ...notFound, status: "throttled", scanned: rank };
          if (!pageResult.products) break;
        }
        const products = pageResult.products ?? [];
        if (products.length === 0) break;
        for (const product of products) {
          rank++;
          if (product.id === nmId) {
            const adPosition =
              product.log && typeof product.log.position === "number"
                ? product.log.position
                : null;
            return {
              status: "found",
              organicPosition: rank,
              adPosition,
              isAd: !!product.log,
              page,
              scanned: rank,
            };
          }
        }
        if (page < maxPages) await sleep(pageDelayMs);
      }
      return { ...notFound, scanned: rank };
    } catch (error) {
      this.logger.warn(
        `probeQueryPosition failed for nm ${nmId} «${query}»: ${(error as Error).message}`,
      );
      return { ...notFound, status: "error" };
    }
  }
}
