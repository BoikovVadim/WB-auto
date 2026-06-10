import { fetchUnifiedChangeLog } from "../../api/syncClientChangeLog";
import { cacheChangeLog, getCachedChangeLog } from "../../api/changeLogCache";
import { fetchUnitEconomicsSettings } from "../../api/syncClientUnitEconomics";
import { cacheSessionJson, getCachedSessionJson } from "../../api/sessionJsonCache";
import type { UnitEconomicsSettings } from "../../api/syncClientUnitEconomics";

/**
 * Прогрев данных холодных разделов на hover/focus пункта меню — чтобы ПЕРВЫЙ заход тоже был
 * без ожидания сети (повторный/F5 уже мгновенны из кэша). Дедуп по наличию кэша: греем один
 * раз, повторные наведения — no-op; сам раздел при открытии всё равно ревалидирует в фоне.
 * Должно совпадать с кэш-ключами/лимитами разделов: DashboardChangeHistorySection (PAGE_SIZE=100,
 * первая порция курсорной пагинации), useUnitEconomicsSettings.
 */
const CHANGE_LOG_LIMIT = 100;
const UNIT_ECONOMICS_SETTINGS_CACHE_KEY = "unit-economics-settings";

export function prefetchChangeHistory(): void {
  if (getCachedChangeLog(CHANGE_LOG_LIMIT) !== null) return;
  void fetchUnifiedChangeLog(CHANGE_LOG_LIMIT)
    .then((entries) => cacheChangeLog(CHANGE_LOG_LIMIT, entries))
    .catch(() => undefined);
}

export function prefetchUnitEconomicsSettings(): void {
  if (getCachedSessionJson<UnitEconomicsSettings>(UNIT_ECONOMICS_SETTINGS_CACHE_KEY) !== null) return;
  void fetchUnitEconomicsSettings()
    .then((settings) => cacheSessionJson(UNIT_ECONOMICS_SETTINGS_CACHE_KEY, settings))
    .catch(() => undefined);
}
