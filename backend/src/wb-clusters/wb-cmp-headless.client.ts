/**
 * Headless-клиент cmp.wildberries.ru для выгрузки состава кластеров по РК
 * (endpoint /api/v5/words-clusters?advertID=...) — замена Safari/AppleScript.
 *
 * Авторизация: storageState (httpOnly session-cookie) → SPA при навигации на cmp
 * сам кладёт короткоживущий `access-token` в localStorage. Запрос шлёт его в
 * AuthorizeV3 + supplier-id из cookie. Токен протухает по ходу прогона → повторная
 * навигация на cmp по session-cookie выдаёт свежий (см. ensureFreshAuth).
 */
import { chromium, type Browser, type LaunchOptions, type Page } from "playwright";

const CMP_LIST_URL = "https://cmp.wildberries.ru/campaigns/list/all";

type BatchResult = Record<string, { ok: boolean; base64?: string; status?: number }>;

export type WbCmpSessionApi = {
  /** Качает words-clusters для пачки advertId параллельно (in-page пул). */
  fetchClusterBatch(advertIds: number[]): Promise<Map<number, Buffer | null>>;
};

export class WbCmpHeadlessClient {
  private readonly storageStatePath: string;
  private readonly executablePath?: string;
  private readonly headless: boolean;
  private readonly concurrency: number;
  private readonly log: (message: string) => void;

  constructor(opts: {
    storageStatePath: string;
    executablePath?: string;
    headless?: boolean;
    concurrency?: number;
    log?: (message: string) => void;
  }) {
    this.storageStatePath = opts.storageStatePath;
    this.executablePath = opts.executablePath;
    this.headless = opts.headless ?? true;
    this.concurrency = opts.concurrency ?? 10;
    this.log = opts.log ?? (() => undefined);
  }

  async runSession<T>(fn: (api: WbCmpSessionApi) => Promise<T>): Promise<T> {
    const launch: LaunchOptions = { headless: this.headless };
    if (this.executablePath) launch.executablePath = this.executablePath;
    const browser: Browser = await chromium.launch(launch);
    try {
      const context = await browser.newContext({ storageState: this.storageStatePath });
      const page = await context.newPage();
      await this.ensureFreshAuth(page, true);
      const api: WbCmpSessionApi = {
        fetchClusterBatch: (advertIds) => this.fetchClusterBatch(page, advertIds),
      };
      return await fn(api);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /** {host, tokenLen} текущей вкладки. */
  private async readAuth(page: Page): Promise<{ host: string; tokenLen: number }> {
    return page
      .evaluate(() => {
        type G = { location: { host: string }; localStorage: { getItem(k: string): string | null } };
        const g = globalThis as unknown as G;
        return { host: g.location.host, tokenLen: (g.localStorage.getItem("access-token") || "").length };
      })
      .catch(() => ({ host: "", tokenLen: 0 }));
  }

  /** Гарантирует вкладку на cmp с непустым access-token (повторная навигация по cookie). */
  private async ensureFreshAuth(page: Page, force = false): Promise<void> {
    if (!force) {
      const cur = await this.readAuth(page);
      if (cur.host.includes("cmp.wildberries.ru") && cur.tokenLen > 0) return;
    }
    await page.goto(CMP_LIST_URL, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
    for (let i = 0; i < 24; i += 1) {
      const s = await this.readAuth(page);
      if (s.host.includes("cmp.wildberries.ru") && s.tokenLen > 0) return;
      await page.waitForTimeout(1500);
    }
    throw new Error("cmp.wildberries.ru: access-token не получен (сессия истекла, нужен вход).");
  }

  private async fetchClusterBatch(page: Page, advertIds: number[]): Promise<Map<number, Buffer | null>> {
    await this.ensureFreshAuth(page);
    const raw = await page.evaluate(
      async (args: { ids: number[]; conc: number }) => {
        type G = {
          localStorage: { getItem(k: string): string | null };
          document: { cookie: string };
          fetch: (u: string, i: { credentials: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
          btoa(s: string): string;
        };
        const g = globalThis as unknown as G;
        const token = g.localStorage.getItem("access-token") || "";
        const m = g.document.cookie.match(/(?:^|; )x-supplier-id-external=([^;]+)/);
        const supp = m ? decodeURIComponent(m[1]) : "";
        const out: Record<string, { ok: boolean; base64?: string; status?: number }> = {};
        if (!token || !supp) return out;

        const queue = args.ids.slice();
        async function worker(): Promise<void> {
          for (;;) {
            const id = queue.shift();
            if (id === undefined) return;
            try {
              const r = await g.fetch("/api/v5/words-clusters?advertID=" + id, {
                credentials: "include",
                headers: { AuthorizeV3: token, "x-supplierid": supp, Lang: "ru" },
              });
              if (!r.ok) {
                out[id] = { ok: false, status: r.status };
                continue;
              }
              const buf = new Uint8Array(await r.arrayBuffer());
              let bin = "";
              const cs = 8192;
              for (let i = 0; i < buf.length; i += cs) {
                bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + cs)));
              }
              out[id] = { ok: true, base64: g.btoa(bin) };
            } catch {
              out[id] = { ok: false, status: -1 };
            }
          }
        }
        const n = Math.max(1, Math.min(args.conc, args.ids.length));
        await Promise.all(Array.from({ length: n }, () => worker()));
        return out;
      },
      { ids: advertIds, conc: this.concurrency },
    );

    const result = new Map<number, Buffer | null>();
    const batch = raw as BatchResult;
    for (const id of advertIds) {
      const entry = batch[String(id)];
      result.set(id, entry && entry.ok && entry.base64 ? Buffer.from(entry.base64, "base64") : null);
    }
    return result;
  }
}
