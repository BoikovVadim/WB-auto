import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import net from "node:net";
import http from "node:http";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

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

const DEST_MOSCOW = "-1257786";
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
  dest?: string;
  /** Сколько прокруток для дозагрузки карточек (глубина «не в топ-N»). */
  scrolls?: number;
}

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

  private async doProbe(
    query: string,
    nmId: number,
    options: PositionProbeOptions,
  ): Promise<PositionProbeResult> {
    const proxy = this.parseProxy();
    if (!proxy) {
      this.logger.warn("WB_SEARCH_PROBE_PROXY не задан — замер позиций невозможен.");
      return { ...NOT_FOUND, status: "blocked" };
    }
    const dest = options.dest ?? DEST_MOSCOW;
    const scrolls = options.scrolls ?? 4;

    try {
      const page = await this.ensureReady(proxy);
      const url = `https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(
        query,
      )}&dest=${dest}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

      // Первый заход проходит challenge (до ~70с); прогретый — карточки появляются быстро.
      const deadline = Date.now() + (this.warmed ? 25_000 : 75_000);
      let count = 0;
      while (Date.now() < deadline) {
        count = await page.locator("[data-nm-id]").count().catch(() => 0);
        if (count > 0) break;
        await page.waitForTimeout(2500);
      }
      if (count === 0) {
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
        this.scheduleIdleClose();
        return { ...NOT_FOUND, status: challenge ? "throttled" : "blocked" };
      }
      this.warmed = true;

      // Дозагружаем карточки прокруткой (глубина «не в топ-N»).
      for (let i = 0; i < scrolls; i++) {
        await page.mouse.wheel(0, 6000);
        await page.waitForTimeout(1200);
      }

      const items = await page.evaluate(() => {
        const g = globalThis as unknown as {
          document: {
            querySelectorAll(
              sel: string,
            ): ArrayLike<{ getAttribute(n: string): string | null; innerText: string }>;
          };
        };
        return Array.from(g.document.querySelectorAll("[data-nm-id]"))
          .map((el) => ({
            nmId: Number(el.getAttribute("data-nm-id")),
            isAd: /реклама/i.test(el.innerText ?? ""),
          }))
          .filter((x) => Number.isFinite(x.nmId) && x.nmId > 0);
      });

      this.scheduleIdleClose();

      let rank = 0;
      for (const item of items) {
        rank++;
        if (item.nmId === nmId) {
          return {
            status: "found",
            organicPosition: rank,
            adPosition: null,
            isAd: item.isAd,
            page: Math.ceil(rank / 100),
            scanned: items.length,
          };
        }
      }
      return { ...NOT_FOUND, scanned: items.length };
    } catch (error) {
      this.logger.warn(
        `probeQueryPosition «${query}» nm ${nmId}: ${(error as Error).message}`,
      );
      // Сбрасываем браузер — следующий замер поднимет свежий.
      await this.close();
      return { ...NOT_FOUND, status: "error" };
    }
  }
}
