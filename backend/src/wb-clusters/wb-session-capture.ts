/**
 * Ручной захват WB-сессии для headless-выгрузок.
 *
 * Зачем: content-analytics API авторизуется httpOnly-cookies, которые видит только
 * браузерный контекст. Playwright их сохраняет в storageState — в отличие от
 * Safari/AppleScript (там httpOnly наружу не отдаётся).
 *
 * Это тонкая обёртка над общим ensureWbSession(forceLogin) — всегда открывает
 * видимое окно входа и сохраняет storageState. Тот же login-on-demand использует
 * фоновый раннер выгрузки, поэтому отдельная копия логики не нужна.
 *
 * Запуск: npm run wb:capture-session   (или ts-node этого файла)
 */
import path from "node:path";

import { ensureWbSession, type WbSessionTarget } from "./ensure-wb-session";

// Читаем env напрямую (без appEnv) — захвату сессии БД не нужна, а appEnv требует DATABASE_URL.
const STORAGE_STATE_PATH =
  process.env.WB_CABINET_STORAGE_STATE_PATH ||
  path.join(process.cwd(), "data", "wb-cabinet-storage-state.json");
const EXECUTABLE_PATH = process.env.WB_CABINET_EXECUTABLE_PATH || undefined;
// WB_CAPTURE_TARGET=cmp — захватить сессию cmp.wildberries.ru (карта запросов);
// по умолчанию content-analytics (частоты).
const TARGET: WbSessionTarget = process.env.WB_CAPTURE_TARGET === "cmp" ? "cmp" : "content-analytics";

ensureWbSession({
  storageStatePath: STORAGE_STATE_PATH,
  target: TARGET,
  executablePath: EXECUTABLE_PATH,
  forceLogin: true,
  log: (m) => console.log(m),
})
  .then(() => {
    console.log(`✅ Сессия захвачена. storageState → ${STORAGE_STATE_PATH}`);
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(`Захват сессии не удался: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
