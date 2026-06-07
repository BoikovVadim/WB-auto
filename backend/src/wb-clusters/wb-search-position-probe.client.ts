import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from "playwright";

import {
  parseProbeProxy,
  Socks5HttpRelay,
  type ParsedProxy,
} from "./wb-search-position-probe.relay";
import { ProbeSessionStore } from "./wb-search-position-probe.state";

/**
 * Зонд места товара в публичной выдаче WB через РЕАЛЬНЫЙ браузер (browser-render).
 *
 * Почему браузер, а не голый fetch: сырой API search.wb.ru отдаёт боту анти-бот заглушку
 * (preset-метадата без товаров) и 429. А прогрев страницы выдачи в Chromium через чистый IP
 * проходит JS-challenge WB (~40-60с ОДИН раз на сессию) и даёт тёплый контекст с cookie.
 *
 * Читаем ДВА фида (см. fetchProductPage / fetchOrganicPage):
 *   • u-search (внутренний, выдача сайта С рекламным бустом) → displayPosition;
 *   • search.wb.ru/exactmatch (внешний, ЧИСТАЯ органика без буста)  → organicPosition.
 * Их разница = на сколько товар поднят рекламой. Рекламную метку (log) WB анониму не отдаёт,
 * поэтому рекламный слот (adPosition) недоступен — органику берём отдельным «чистым» фидом.
 *
 * Тёплый браузер держим между замерами (прогрев платится один раз). Замеры сериализуем
 * (одна страница — один навигатор за раз). Картинки/шрифты блокируем — экономим трафик
 * мобильного прокси. Прокси задаётся в env WB_SEARCH_PROBE_PROXY (socks5://user:pass@host:port);
 * Chromium не умеет SOCKS-auth, поэтому поднимаем локальный http→socks5 релей.
 */

const PROBE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
/** Браузер закрываем после простоя — освобождаем ~400МБ RAM. */
const IDLE_CLOSE_MS = 10 * 60_000;

export type PositionProbeStatus =
  | "found"
  | "not_found"
  | "throttled"
  | "blocked"
  | "error";

export interface PositionProbeResult {
  status: PositionProbeStatus;
  /** Метрика 1 — ЧИСТАЯ органика без рекламы (позиция в внешнем search.wb.ru/exactmatch). */
  organicPosition: number | null;
  /** Метрика 2 — позиция в выдаче сайта С рекламным бустом (что видит покупатель, u-search). */
  displayPosition: number | null;
  /** Метрика 3 — рекламный слот. НЕДОСТУПЕН: WB не отдаёт рекл. метку анониму → всегда null. */
  adPosition: number | null;
  /** Реклама заметно бустит товар: displayPosition выше чистой органики на ≥5 позиций. */
  isAd: boolean;
  page: number | null;
  scanned: number;
}

export interface PositionProbeOptions {
  /** До скольких мест искать (топ-N); глубже — «>N». */
  depth?: number;
}

/** Глубина поиска места по умолчанию — топ-300 (не нашли → «>300»). */
const DEFAULT_DEPTH = 300;

const NOT_FOUND: PositionProbeResult = {
  status: "not_found",
  organicPosition: null,
  displayPosition: null,
  adPosition: null,
  isAd: false,
  page: null,
  scanned: 0,
};

@Injectable()
export class WbSearchPositionProbeClient implements OnModuleDestroy {
  private readonly logger = new Logger(WbSearchPositionProbeClient.name);

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly relay = new Socks5HttpRelay();
  private relayPort = 0;
  private warmed = false;
  /** Шаблон внутреннего product-endpoint, пойманный при прогреве (params + spa-version). */
  private searchBaseUrl: string | null = null;
  private spaVersion = "";
  private idleTimer: NodeJS.Timeout | null = null;
  /** Мьютекс: замеры идут строго по одному (одна страница на всех). */
  private chain: Promise<unknown> = Promise.resolve();
  /** Персистенция тёплой сессии между рестартами процесса (мгновенно после деплоя). */
  private readonly store = new ProbeSessionStore();
  /** Шаблон эндпоинта, восстановленный с диска и ждущий проверки лёгким запросом. */
  private pendingRestore: { url: string; spa: string } | null = null;

  private async ensureReady(proxy: ParsedProxy | null): Promise<Page> {
    if (this.page && this.browser?.isConnected()) return this.page;
    // Прокси опционален: тёплый браузер сам проходит JS-челлендж WB, поэтому серверный IP
    // работает напрямую. Если задан WB_SEARCH_PROBE_PROXY — поднимаем релей и ходим через него.
    if (proxy && !this.relayPort) this.relayPort = await this.relay.start(proxy);

    // Восстанавливаем сохранённые cookies WB — после рестарта это позволяет пропустить
    // 75с challenge (проверим сессию лёгким запросом в ensureWarm).
    const hasState = this.store.hasStorageState();
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      ...(proxy ? { proxy: { server: `http://127.0.0.1:${this.relayPort}` } } : {}),
      locale: "ru-RU",
      userAgent: PROBE_UA,
      viewport: { width: 1366, height: 900 },
      ...(hasState ? { storageState: this.store.storageStatePath } : {}),
    });
    this.pendingRestore = hasState ? this.store.loadTemplate() : null;
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    // Картинки/шрифты/медиа не грузим — экономим трафик мобильного прокси.
    await this.context.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media" || type === "font") return route.abort();
      return route.continue();
    });
    this.page = await this.context.newPage();
    this.warmed = false;
    return this.page;
  }

  /**
   * Keep-warm включён по умолчанию, если задан прокси (отключить — WB_POSITION_KEEP_WARM=0).
   * В этом режиме грелка (PositionProbeWarmerService) держит сессию постоянно, а idle-close
   * становится no-op — браузер не умирает по простою, клик всегда отдаёт тёплый результат.
   */
  private keepWarmEnabled(): boolean {
    return process.env.WB_POSITION_KEEP_WARM !== "0";
  }

  /** Тёплая ли сессия прямо сейчас (для грелки/диагностики). */
  isWarm(): boolean {
    return (
      this.warmed && !!this.searchBaseUrl && !!this.page && !!this.browser?.isConnected()
    );
  }

  private scheduleIdleClose() {
    if (this.keepWarmEnabled()) return; // грелка держит сессию постоянно
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.close(), IDLE_CLOSE_MS);
  }

  private async close() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const browser = this.browser;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.warmed = false;
    this.searchBaseUrl = null;
    if (browser) await browser.close().catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.close();
    this.relay.close();
  }

  async probeQueryPosition(
    query: string,
    nmId: number,
    options: PositionProbeOptions = {},
  ): Promise<PositionProbeResult> {
    const run = this.chain.then(
      () => this.doProbe(query, nmId, options),
      () => this.doProbe(query, nmId, options),
    );
    this.chain = run.catch(() => undefined);
    return run;
  }

  /**
   * Поддержать тёплую сессию (зовёт грелка). Холодно → полный прогрев (~75с, фоном);
   * тепло → лёгкий запрос страницы 1, чтобы освежить cookie/сессию мобильного прокси.
   * Сериализуется с замерами тем же мьютексом. Возвращает false, если сессия мертва
   * (сбросили шаблон — следующий прогрев навигирует заново). */
  async heartbeat(query: string): Promise<boolean> {
    const run = this.chain.then(
      () => this.doHeartbeat(query),
      () => this.doHeartbeat(query),
    );
    this.chain = run.catch(() => false);
    return run;
  }

  private async doHeartbeat(query: string): Promise<boolean> {
    const proxy = parseProbeProxy(); // null = ходим напрямую с IP сервера
    try {
      const page = await this.ensureReady(proxy);
      const warm = await this.ensureWarm(page, query);
      if (warm !== "ok") return false;
      const first = await this.fetchProductPage(query, 1);
      this.scheduleIdleClose();
      if (first.length === 0) {
        this.searchBaseUrl = null;
        this.warmed = false;
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`heartbeat «${query}»: ${(error as Error).message}`);
      await this.close();
      return false;
    }
  }

  /** Сменить мобильный IP (changeip-ссылка) и закрыть браузер — следующая попытка
   *  поднимет свежую сессию на новом адресе. */
  private async rotateAndReset() {
    const changeUrl = process.env.WB_PROXY_CHANGEIP;
    if (changeUrl) {
      await fetch(changeUrl).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 10_000));
    }
    await this.close();
  }

  /**
   * Замер с ретраем: headless + один мобильный IP пробивает анти-бот через раз. На
   * blocked/throttled/error меняем IP, пересоздаём сессию и пробуем ещё раз (до 2 попыток).
   */
  private async doProbe(
    query: string,
    nmId: number,
    options: PositionProbeOptions,
  ): Promise<PositionProbeResult> {
    let last: PositionProbeResult = { ...NOT_FOUND, status: "blocked" };
    for (let attempt = 1; attempt <= 2; attempt++) {
      last = await this.attemptProbe(query, nmId, options);
      if (last.status === "found" || last.status === "not_found") return last;
      if (attempt < 2) await this.rotateAndReset();
    }
    return last;
  }

  /**
   * Прогрев: один раз навигируем на страницу выдачи, проходим JS-challenge и ловим
   * внутренний product-endpoint (www.wildberries.ru/__internal/u-search/.../search),
   * который страница дёргает при догрузке. Запоминаем его URL-шаблон + x-spa-version.
   * Дальше замеры идут лёгкими API-вызовами к нему (без скролла и повторного challenge).
   */
  private async ensureWarm(
    page: Page,
    query: string,
  ): Promise<"ok" | "throttled" | "blocked"> {
    if (this.searchBaseUrl) return "ok";

    // Быстрое восстановление после рестарта: есть сохранённый шаблон + cookies → проверяем
    // сессию одним лёгким запросом (~1с) вместо ~75с challenge.
    if (this.pendingRestore) {
      const restore = this.pendingRestore;
      this.pendingRestore = null;
      this.searchBaseUrl = restore.url;
      this.spaVersion = restore.spa;
      const check = await this.fetchProductPage(query, 1).catch(() => []);
      if (check.length > 0) {
        this.warmed = true;
        this.logger.log("probe: тёплое восстановление из сохранённой сессии (без прогрева)");
        return "ok";
      }
      this.searchBaseUrl = null; // сессия протухла → полный прогрев ниже
    }

    const holder: { value: { url: string; spa: string } | null } = { value: null };
    const onRequest = (req: Request) => {
      const u = req.url();
      if (u.includes("/__internal/u-search/") && !holder.value) {
        holder.value = { url: u, spa: req.headers()["x-spa-version"] ?? "" };
      }
    };
    page.on("request", onRequest);
    try {
      await page.goto(
        `https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(query)}`,
        { waitUntil: "domcontentloaded", timeout: 45_000 },
      );
      const start = Date.now();
      while (!holder.value && Date.now() - start < 75_000) {
        await page
          .evaluate(() => {
            const g = globalThis as unknown as { scrollBy(x: number, y: number): void };
            g.scrollBy(0, 2500);
          })
          .catch(() => undefined);
        await page.waitForTimeout(1500);
      }
    } finally {
      page.off("request", onRequest);
    }
    const captured = holder.value;
    if (!captured) {
      const challenge = await page
        .evaluate(() => {
          const g = globalThis as unknown as {
            document: { body: { innerText: string } | null };
          };
          return /Подозрительная|Почти готово|Что-то не так/.test(
            g.document.body?.innerText ?? "",
          );
        })
        .catch(() => false);
      return challenge ? "throttled" : "blocked";
    }
    this.searchBaseUrl = captured.url;
    if (captured.spa) this.spaVersion = captured.spa;
    this.warmed = true;
    // Сохраняем сессию на диск — следующий рестарт восстановится без 75с прогрева.
    if (this.context) {
      await this.store
        .persist(this.context, { url: captured.url, spa: this.spaVersion })
        .catch((e: Error) => this.logger.warn(`persist session: ${e.message}`));
    }
    return "ok";
  }

  /**
   * Одна страница (100 товаров) ВНУТРЕННЕГО product-endpoint (www.wildberries.ru/__internal/
   * u-search) в прогретом контексте. Это выдача, которую SSR-ит сам сайт = С РЕКЛАМНЫМ
   * БУСТОМ (порядок включает забустенные рекламой карточки) → даёт displayPosition. Рекламная
   * метка (поле log/logs) WB здесь анониму не отдаёт, поэтому отличить рекламу внутри этого
   * фида нельзя — чистую органику берём из ВТОРОГО фида (fetchOrganicPage / search.wb.ru).
   */
  private async fetchProductPage(
    query: string,
    pageNumber: number,
  ): Promise<Array<{ id: number }>> {
    if (!this.context || !this.searchBaseUrl) return [];
    const url = new URL(this.searchBaseUrl);
    url.searchParams.set("query", query);
    url.searchParams.set("page", String(pageNumber));
    const res = await this.context.request.get(url.toString(), {
      headers: {
        "x-requested-with": "XMLHttpRequest",
        "x-spa-version": this.spaVersion,
        "x-userid": "0",
        "x-queryid": `qid${Date.now()}${Math.floor(Math.random() * 1_000_000)}`,
      },
      timeout: 20_000,
    });
    if (res.status() !== 200) return [];
    try {
      const json = JSON.parse(await res.text()) as {
        products?: Array<{ id: number }>;
      };
      return json.products ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Одна страница ЧИСТОЙ ОРГАНИКИ из ВНЕШНЕГО публичного search.wb.ru/exactmatch — этот фид
   * НЕ подмешивает рекламный буст (A/B подтверждён: забустенные на сайте карточки в нём стоят
   * на десятки позиций ниже / вообще вне топа). Даёт organicPosition «где товар был бы без
   * рекламы». ВАЖНО: тянем браузерным fetch ВНУТРИ тёплой страницы www.wildberries.ru —
   * APIRequestContext к search.wb.ru режется 429, а fetch из браузерного контекста (с cookie
   * и fingerprint) проходит анти-бот и отдаёт 200. dest/hide_* берём из пойманного u-search
   * шаблона, чтобы регион выдачи совпадал с displayPosition.
   */
  private async fetchOrganicPage(
    query: string,
    pageNumber: number,
  ): Promise<number[]> {
    if (!this.page || !this.searchBaseUrl) return [];
    const tpl = new URL(this.searchBaseUrl);
    const dest = tpl.searchParams.get("dest") ?? "";
    const hideDtype = tpl.searchParams.get("hide_dtype") ?? "15";
    const hideVflags = tpl.searchParams.get("hide_vflags") ?? "4294967296";
    const organicUrl =
      `https://search.wb.ru/exactmatch/ru/common/v18/search?appType=1&curr=rub` +
      `&dest=${encodeURIComponent(dest)}&hide_dtype=${encodeURIComponent(hideDtype)}` +
      `&hide_vflags=${encodeURIComponent(hideVflags)}&lang=ru&page=${pageNumber}` +
      `&query=${encodeURIComponent(query)}&resultset=catalog&sort=popular&spp=30&suppressSpellcheck=false`;
    try {
      const ids = await this.page.evaluate(async (u: string): Promise<number[] | null> => {
        const r = await fetch(u, { headers: { Accept: "*/*" } });
        if (r.status !== 200) return null;
        const body = (await r.json().catch(() => null)) as {
          products?: Array<{ id: number }>;
        } | null;
        if (!body || !Array.isArray(body.products)) return null;
        return body.products.map((p) => p.id);
      }, organicUrl);
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  }

  private async attemptProbe(
    query: string,
    nmId: number,
    options: PositionProbeOptions,
  ): Promise<PositionProbeResult> {
    // Прокси опционален — без него ходим напрямую с IP сервера (тёплый браузер проходит
    // челлендж сам). parseProbeProxy() вернёт null, если WB_SEARCH_PROBE_PROXY не задан.
    const proxy = parseProbeProxy();
    const envDepth = Number(process.env.WB_POSITION_DEPTH);
    const depth =
      options.depth ??
      (Number.isFinite(envDepth) && envDepth > 0 ? envDepth : DEFAULT_DEPTH);
    const t0 = Date.now();
    const elapsed = () => `${Math.round((Date.now() - t0) / 1000)}s`;

    try {
      const page = await this.ensureReady(proxy);
      const warm = await this.ensureWarm(page, query);
      if (warm !== "ok") {
        this.scheduleIdleClose();
        this.logger.warn(`probe «${query}» nm ${nmId}: прогрев не прошёл (${warm}) за ${elapsed()}`);
        return { ...NOT_FOUND, status: warm };
      }

      // ДВА ФИДА ПАРАЛЛЕЛЬНО (латентность ≈ одного, тянутся конкурентно):
      //  • u-search (выдача сайта, С рекламным бустом) → displayPosition «что видит покупатель»;
      //  • search.wb.ru (внешняя ЧИСТАЯ органика, без буста) → organicPosition «без рекламы».
      // Все страницы 1..N стартуем сразу; сканируем полностью (не early-exit) — товар в разных
      // фидах лежит на разной глубине.
      const maxPages = Math.max(1, Math.min(Math.ceil(depth / 100), 3));
      const tPage = Date.now();
      const [displayPages, organicPages] = await Promise.all([
        Promise.all(
          Array.from({ length: maxPages }, (_, i) => this.fetchProductPage(query, i + 1)),
        ),
        Promise.all(
          Array.from({ length: maxPages }, (_, i) => this.fetchOrganicPage(query, i + 1)),
        ),
      ]);
      this.logger.log(
        `probe «${query}»: ${maxPages} стр. ×2 фида за ${Date.now() - tPage}ms`,
      );
      this.scheduleIdleClose();

      const displayScanned = displayPages.reduce((sum, list) => sum + list.length, 0);
      const organicScanned = organicPages.reduce((sum, list) => sum + list.length, 0);
      // Оба фида пустые → анти-бот заглушил (challenge/429), а не «товара нет».
      if (displayScanned === 0 && organicScanned === 0) {
        this.logger.warn(`probe «${query}» nm ${nmId}: оба фида вернули 0 за ${elapsed()}`);
        return { ...NOT_FOUND, status: "blocked" };
      }

      const rankOf = (lists: Array<Array<{ id: number }>>): number | null => {
        let rank = 0;
        for (const list of lists) {
          for (const item of list) {
            rank++;
            if (rank > depth) return null;
            if (item.id === nmId) return rank;
          }
        }
        return null;
      };
      // displayPosition — порядок в выдаче сайта (с рекламой); organicPosition — в чистой органике.
      const displayPosition = rankOf(displayPages);
      const organicPosition = rankOf(organicPages.map((ids) => ids.map((id) => ({ id }))));
      const scanned = Math.min(Math.max(displayScanned, organicScanned), depth);

      if (displayPosition !== null || organicPosition !== null) {
        // Буст рекламы: насколько сайт поднял товар над чистой органикой (organic − display).
        const boosted =
          displayPosition !== null &&
          organicPosition !== null &&
          organicPosition - displayPosition >= 5;
        this.logger.log(
          `probe «${query}» nm ${nmId}: орг ${organicPosition ?? "—"} / показ ${displayPosition ?? "—"}${boosted ? " (буст)" : ""} за ${elapsed()}`,
        );
        const refPos = displayPosition ?? organicPosition!;
        return {
          status: "found",
          organicPosition,
          displayPosition,
          adPosition: null, // рекламный слот WB анониму не отдаёт — метрика недоступна
          isAd: boosted,
          page: Math.ceil(refPos / 100),
          scanned,
        };
      }
      this.logger.log(`probe «${query}» nm ${nmId}: не в топ-${scanned} за ${elapsed()}`);
      return { ...NOT_FOUND, scanned };
    } catch (error) {
      this.logger.warn(`probe «${query}» nm ${nmId}: ${(error as Error).message}`);
      await this.close();
      return { ...NOT_FOUND, status: "error" };
    }
  }
}
