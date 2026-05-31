import { executeAppleScript } from "./wb-cmp-safari.client.apple-script";

// Safari-автоматизация одного окна cmp.wildberries.ru + восстановление cmp-сессии
// для импорта карты запросов (fill-query-map-from-cmp-api). Вынесено отдельным
// модулем, чтобы основной файл не превышал порог размера.

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function runAppleScript(script: string, timeoutMs = 30_000): Promise<string> {
  return executeAppleScript(script, { timeoutMs, errorContext: "fill-query-map-from-cmp-api" });
}

export async function ensureCmpWindowId(): Promise<number> {
  const script = `
tell application "Safari"
  set foundId to 0
  repeat with w in windows
    repeat with tr in tabs of w
      try
        if (URL of tr) contains "cmp.wildberries.ru" then
          set foundId to id of w
          exit repeat
        end if
      on error
      end try
    end repeat
    if foundId > 0 then exit repeat
  end repeat
  if foundId > 0 then return foundId as text

  make new document with properties {URL:"https://cmp.wildberries.ru/campaigns/list"}
  delay 0.5
  set nw to front window
  repeat 160 times
    try
      if (do JavaScript "document.readyState" in current tab of nw) is "complete" then exit repeat
    on error
    end try
    delay 0.25
  end repeat
  return (id of nw) as text
end tell`.trim();

  const raw = await runAppleScript(script, 50_000);
  const id = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Unexpected Safari window id: "${raw}"`);
  return id;
}

export async function injectIntoWindow(windowId: number, js: string, timeoutMs = 20_000): Promise<string> {
  const script = `
set jsCode to ${JSON.stringify(js)}
tell application "Safari"
  return do JavaScript jsCode in current tab of window id ${windowId}
end tell`.trim();
  return runAppleScript(script, timeoutMs);
}

// cmp-токен (access-token в localStorage origin cmp.wildberries.ru) короткоживущий:
// по ходу прогона он протухает, fetch ловит 401, и WB-SPA редиректит окно на
// seller.wildberries.ru — там cmp-токена нет, и остаток прогона падает. Ниже —
// проверка/восстановление: ре-навигация на cmp/campaigns/list, чтобы SPA по живой
// session-cookie переавторизовался и выдал свежий токен.

export async function probeCmpAuth(
  windowId: number,
): Promise<{ onCmp: boolean; ready: boolean; token: number }> {
  const js = `(function(){ try { return JSON.stringify({ host: location.host, ready: document.readyState, token: (localStorage.getItem("access-token")||"").length }); } catch (e) { return JSON.stringify({ host: "", ready: "", token: 0 }); } })()`;
  try {
    const raw = await injectIntoWindow(windowId, js, 10_000);
    const s = JSON.parse(raw) as { host?: string; ready?: string; token?: number };
    return {
      onCmp: typeof s.host === "string" && s.host.includes("cmp.wildberries.ru"),
      ready: s.ready === "complete",
      token: typeof s.token === "number" ? s.token : 0,
    };
  } catch {
    return { onCmp: false, ready: false, token: 0 };
  }
}

/**
 * Гарантирует, что окно на cmp и cmp-токен жив. Если нет — ре-навигирует на cmp и
 * ждёт свежий токен (до ~60с). Возвращает валидный id окна (может отличаться, если
 * окно пере-захвачено) или null, если сессия мертва (нужен ручной ре-логин).
 */
export async function ensureCmpAuth(windowId: number): Promise<number | null> {
  const initial = await probeCmpAuth(windowId);
  if (initial.onCmp && initial.token > 0) return windowId;

  // Окно могло быть закрыто/передёрнуто WB на seller (id больше не валиден).
  // Пытаемся ре-навигировать текущее окно; если osascript падает — пере-захватываем
  // (находим/создаём) cmp-окно через ensureCmpWindowId. Любая ошибка здесь не должна
  // ронять весь прогон.
  let targetId = windowId;
  try {
    await runAppleScript(
      `tell application "Safari" to set URL of current tab of window id ${targetId} to "https://cmp.wildberries.ru/campaigns/list"`,
      20_000,
    );
  } catch {
    try {
      targetId = await ensureCmpWindowId();
    } catch {
      return null;
    }
  }

  for (let i = 0; i < 30; i += 1) {
    await sleep(2000);
    const s = await probeCmpAuth(targetId);
    if (s.onCmp && s.ready && s.token > 0) return targetId;
  }
  return null;
}
