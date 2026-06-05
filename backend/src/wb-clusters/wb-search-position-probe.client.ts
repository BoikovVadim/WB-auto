import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import net from "node:net";
import http from "node:http";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from "playwright";

/**
 * Зонд места товара в публичной выдаче WB через РЕАЛЬНЫЙ браузер (browser-render).
 *
 * Почему браузер, а не голый fetch: сырой API search.wb.ru отдаёт боту анти-бот заглушку
 * (preset-метадата без товаров) и 429. А загрузка самой страницы выдачи в Chromium через
 * чистый (мобильный) IP проходит JS-challenge WB (~40-60с ОДИН раз на прогрев сессии) и
 * SSR-ит реальные карточки — мы читаем их из DOM (data-nm-id = порядок выдачи).
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
  organicPosition: number | null;
  adPosition: number | null;
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

interface ParsedProxy {
  host: string;
  port: number;
  user: string;
  pass: string;
}

const NOT_FOUND: PositionProbeResult = {
  status: "not_found",
  organicPosition: null,
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
  private relay: http.Server | null = null;
  private relayPort = 0;
  private warmed = false;
  /** Шаблон внутреннего product-endpoint, пойманный при прогреве (params + spa-version). */
  private searchBaseUrl: string | null = null;
  private spaVersion = "";
  private idleTimer: NodeJS.Timeout | null = null;
  /** Мьютекс: замеры идут строго по одному (одна страница на всех). */
  private chain: Promise<unknown> = Promise.resolve();

  private parseProxy(): ParsedProxy | null {
    const raw = process.env.WB_SEARCH_PROBE_PROXY;
    if (!raw) return null;
    try {
      const u = new URL(raw);
      return {
        host: u.hostname,
        port: Number(u.port),
        user: decodeURIComponent(u.username),
        pass: decodeURIComponent(u.password),
      };
    } catch {
      return null;
    }
  }

  // --- SOCKS5 (RFC1928 + RFC1929 auth) → локальный http CONNECT релей ---
  private socks5Connect(
    proxy: ParsedProxy,
    host: string,
    port: number,
  ): Promise<{ sock: net.Socket; leftover: Buffer }> {
    return new Promise((resolve, reject) => {
      const s = net.connect(proxy.port, proxy.host);
      let buf = Buffer.alloc(0);
      let stage = 0;
      const fail = (e: unknown) => {
        s.destroy();
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      s.once("error", fail);
      s.once("connect", () => s.write(Buffer.from([0x05, 0x01, 0x02])));
      const onData = (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        if (stage === 0) {
          if (buf.length < 2) return;
          if (buf[0] !== 0x05 || buf[1] !== 0x02) return fail("no userpass auth");
          buf = buf.subarray(2);
          stage = 1;
          const ub = Buffer.from(proxy.user);
          const pb = Buffer.from(proxy.pass);
          s.write(
            Buffer.concat([Buffer.from([0x01, ub.length]), ub, Buffer.from([pb.length]), pb]),
          );
        }
        if (stage === 1) {
          if (buf.length < 2) return;
          if (buf[1] !== 0x00) return fail("auth rejected");
          buf = buf.subarray(2);
          stage = 2;
          const hb = Buffer.from(host);
          s.write(
            Buffer.concat([
              Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]),
              hb,
              Buffer.from([port >> 8, port & 0xff]),
            ]),
          );
        }
        if (stage === 2) {
          if (buf.length < 5) return;
          if (buf[1] !== 0x00) return fail("connect failed " + buf[1]);
          const atyp = buf[3];
          const need = atyp === 0x01 ? 10 : atyp === 0x04 ? 22 : 4 + 1 + buf[4]! + 2;
          if (buf.length < need) return;
          const leftover = buf.subarray(need);
          s.removeListener("data", onData);
          s.removeListener("error", fail);
          resolve({ sock: s, leftover });
        }
      };
      s.on("data", onData);
    });
  }

  private startRelay(proxy: ParsedProxy): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      server.on("connect", (req, clientSocket, head) => {
        const [host, portStr] = (req.url ?? "").split(":");
        void this.socks5Connect(proxy, host!, Number(portStr || 443))
          .then(({ sock, leftover }) => {
            clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (leftover.length) clientSocket.write(leftover);
            if (head.length) sock.write(head);
            sock.pipe(clientSocket);
            clientSocket.pipe(sock);
            const kill = () => {
              sock.destroy();
              clientSocket.destroy();
            };
            sock.on("error", kill);
            clientSocket.on("error", kill);
          })
          .catch(() => {
            try {
              clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
            } catch {
              /* noop */
            }
            clientSocket.destroy();
          });
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        this.relay = server;
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
  }

  private async ensureReady(proxy: ParsedProxy): Promise<Page> {
    if (this.page && this.browser?.isConnected()) return this.page;
    if (!this.relay) this.relayPort = await this.startRelay(proxy);

    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      proxy: { server: `http://127.0.0.1:${this.relayPort}` },
      locale: "ru-RU",
      userAgent: PROBE_UA,
      viewport: { width: 1366, height: 900 },
    });
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

  private scheduleIdleClose() {
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
    this.relay?.close();
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
    return "ok";
  }

  /** Одна страница (100 товаров) внутреннего product-endpoint в прогретом контексте. */
  private async fetchProductPage(
    query: string,
    pageNumber: number,
  ): Promise<Array<{ id: number; log?: unknown }>> {
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
        products?: Array<{ id: number; log?: unknown }>;
      };
      return json.products ?? [];
    } catch {
      return [];
    }
  }

  private async attemptProbe(
    query: string,
    nmId: number,
    options: PositionProbeOptions,
  ): Promise<PositionProbeResult> {
    const proxy = this.parseProxy();
    if (!proxy) {
      this.logger.warn("WB_SEARCH_PROBE_PROXY не задан — замер позиций невозможен.");
      return { ...NOT_FOUND, status: "blocked" };
    }
    const depth = options.depth ?? DEFAULT_DEPTH;
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

      // Внутренний product-endpoint: страницы 1..N по 100 товаров, ПАРАЛЛЕЛЬНО.
      const pages = Math.max(1, Math.min(Math.ceil(depth / 100), 3));
      const results = await Promise.all(
        Array.from({ length: pages }, (_, i) => this.fetchProductPage(query, i + 1)),
      );
      this.scheduleIdleClose();

      const total = results.reduce((sum, list) => sum + list.length, 0);
      if (total === 0) {
        this.logger.warn(`probe «${query}» nm ${nmId}: endpoint вернул 0 за ${elapsed()}`);
        return { ...NOT_FOUND, status: "blocked" };
      }

      let rank = 0;
      for (const products of results) {
        for (const product of products) {
          rank++;
          if (rank > depth) break;
          if (product.id === nmId) {
            this.logger.log(`probe «${query}» nm ${nmId}: место ${rank} за ${elapsed()}`);
            return {
              status: "found",
              organicPosition: rank,
              adPosition: null,
              isAd: !!product.log,
              page: Math.ceil(rank / 100),
              scanned: rank,
            };
          }
        }
      }
      const scanned = Math.min(rank, depth);
      this.logger.log(`probe «${query}» nm ${nmId}: не в топ-${scanned} за ${elapsed()}`);
      return { ...NOT_FOUND, scanned };
    } catch (error) {
      this.logger.warn(`probe «${query}» nm ${nmId}: ${(error as Error).message}`);
      await this.close();
      return { ...NOT_FOUND, status: "error" };
    }
  }
}
