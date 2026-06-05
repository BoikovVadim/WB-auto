import fs from "node:fs";
import path from "node:path";
import type { BrowserContext } from "playwright";

/**
 * Персистенция тёплой WB-сессии зонда позиций между перезапусками процесса.
 *
 * 75с прогрева — это JS-challenge WB, который выдаёт cookie/сессию и шаблон внутреннего
 * product-endpoint (+ x-spa-version). Всё это переживает рестарт, если сохранить на диск:
 * cookies — через Playwright storageState, шаблон эндпоинта — мелким JSON. После деплоя
 * (pm2 reload убивает Chromium в памяти) зонд НЕ проходит challenge заново, а восстанавливает
 * сессию и проверяет её одним лёгким запросом (~1с вместо ~75с).
 *
 * Файлы лежат в data/ под cwd процесса (/var/www/wb-automation) — деплой эту папку не трогает.
 */

export interface ProbeEndpointTemplate {
  /** URL-шаблон внутреннего product-endpoint, пойманный при прогреве. */
  url: string;
  /** x-spa-version, нужный для запросов к endpoint. */
  spa: string;
}

export class ProbeSessionStore {
  /** Путь storageState (Playwright читает/пишет сам). */
  readonly storageStatePath: string;
  private readonly templatePath: string;

  constructor() {
    const dir =
      process.env.WB_POSITION_STATE_DIR || path.join(process.cwd(), "data");
    this.storageStatePath = path.join(dir, "wb-position-storage-state.json");
    this.templatePath = path.join(dir, "wb-position-endpoint.json");
  }

  /** Есть ли сохранённые cookies (можно ли восстановить сессию). */
  hasStorageState(): boolean {
    return fs.existsSync(this.storageStatePath);
  }

  /** Сохранённый шаблон эндпоинта, либо null. */
  loadTemplate(): ProbeEndpointTemplate | null {
    try {
      if (!fs.existsSync(this.templatePath)) return null;
      const raw = JSON.parse(fs.readFileSync(this.templatePath, "utf8")) as {
        url?: string;
        spa?: string;
      };
      return raw.url ? { url: raw.url, spa: raw.spa ?? "" } : null;
    } catch {
      return null;
    }
  }

  /** Сохранить cookies + шаблон эндпоинта на диск (после успешного прогрева). */
  async persist(context: BrowserContext, template: ProbeEndpointTemplate): Promise<void> {
    fs.mkdirSync(path.dirname(this.storageStatePath), { recursive: true });
    await context.storageState({ path: this.storageStatePath });
    fs.writeFileSync(this.templatePath, JSON.stringify(template));
  }
}
