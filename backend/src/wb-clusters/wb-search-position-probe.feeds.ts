import type { BrowserContext, Page } from "playwright";

/**
 * Чтение двух фидов выдачи WB для зонда позиций (вынесено из клиента — отдельная
 * ответственность «доступ к данным выдачи»; клиент держит lifecycle браузера/сессии).
 *
 *   • fetchDisplayPage — внутренний u-search (выдача сайта С рекламным бустом) → displayPosition;
 *   • fetchOrganicPage — внешний search.wb.ru/exactmatch (ЧИСТАЯ органика без буста) → organicPosition.
 * Разница позиций = на сколько товар поднят рекламой. Рекламную метку (log) WB анониму не отдаёт,
 * поэтому органику нельзя вычислить внутри u-search — берём её отдельным «чистым» фидом.
 */

/**
 * Одна страница (100 товаров) ВНУТРЕННЕГО product-endpoint (www.wildberries.ru/__internal/
 * u-search) в прогретом контексте — выдача, которую SSR-ит сам сайт = С РЕКЛАМНЫМ БУСТОМ.
 */
export async function fetchDisplayPage(
  context: BrowserContext | null,
  searchBaseUrl: string | null,
  spaVersion: string,
  query: string,
  pageNumber: number,
): Promise<Array<{ id: number }>> {
  if (!context || !searchBaseUrl) return [];
  const url = new URL(searchBaseUrl);
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(pageNumber));
  const res = await context.request.get(url.toString(), {
    headers: {
      "x-requested-with": "XMLHttpRequest",
      "x-spa-version": spaVersion,
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
 * Гарантирует, что тёплая страница стоит на www.wildberries.ru — fetch к search.wb.ru
 * проходит анти-бот/CORS только с этого Origin. При ТЁПЛОМ ВОССТАНОВЛЕНИИ сессии (после
 * реплоя) страница остаётся на about:blank — навигируем один раз; дальше она держит origin.
 */
export async function ensureOrganicOrigin(page: Page | null): Promise<void> {
  if (!page) return;
  if (page.url().includes("wildberries.ru")) return;
  try {
    await page.goto("https://www.wildberries.ru/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
  } catch {
    /* не критично — organic-фид просто вернёт пусто, displayPosition останется */
  }
}

/**
 * Одна страница ЧИСТОЙ ОРГАНИКИ из ВНЕШНЕГО публичного search.wb.ru/exactmatch — этот фид
 * НЕ подмешивает рекламный буст (A/B подтверждён: забустенные на сайте карточки в нём стоят
 * на десятки позиций ниже / вообще вне топа). ВАЖНО: тянем браузерным fetch ВНУТРИ тёплой
 * страницы www.wildberries.ru — APIRequestContext к search.wb.ru режется 429, а fetch из
 * браузерного контекста (с cookie и fingerprint) проходит анти-бот и отдаёт 200. dest/hide_*
 * берём из пойманного u-search шаблона, чтобы регион выдачи совпадал с displayPosition.
 */
export async function fetchOrganicPage(
  page: Page | null,
  searchBaseUrl: string | null,
  query: string,
  pageNumber: number,
): Promise<number[]> {
  if (!page || !searchBaseUrl) return [];
  const tpl = new URL(searchBaseUrl);
  const dest = tpl.searchParams.get("dest") ?? "";
  const hideDtype = tpl.searchParams.get("hide_dtype") ?? "15";
  const hideVflags = tpl.searchParams.get("hide_vflags") ?? "4294967296";
  const organicUrl =
    `https://search.wb.ru/exactmatch/ru/common/v18/search?appType=1&curr=rub` +
    `&dest=${encodeURIComponent(dest)}&hide_dtype=${encodeURIComponent(hideDtype)}` +
    `&hide_vflags=${encodeURIComponent(hideVflags)}&lang=ru&page=${pageNumber}` +
    `&query=${encodeURIComponent(query)}&resultset=catalog&sort=popular&spp=30&suppressSpellcheck=false`;
  try {
    const ids = await page.evaluate(async (u: string): Promise<number[] | null> => {
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

/** Ранг nm_id в постраничном списке (1-based по всем страницам); null если глубже depth/нет. */
export function rankOf(
  lists: Array<Array<{ id: number }>>,
  nmId: number,
  depth: number,
): number | null {
  let rank = 0;
  for (const list of lists) {
    for (const item of list) {
      rank++;
      if (rank > depth) return null;
      if (item.id === nmId) return rank;
    }
  }
  return null;
}
