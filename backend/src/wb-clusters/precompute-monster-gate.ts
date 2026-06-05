// Гейт ночного precompute по размеру «вселенной запросов» товара. Сборка листа товара
// тянет ВСЕ строки wb_cabinet_cluster_queries в JS-память; у товаров-монстров одна
// сборка пробивает heap-лимит → FATAL OOM роняет весь бэкенд ради прогрева одного
// товара. Поэтому такие товары исключаются из ночного прогона (материализуются
// on-demand, по одному, при открытии). Чистая логика — без зависимостей, под тест.

import type { ProductSnapshotWarmupPriority } from "./wb-clusters.types";

type PrecomputePeriod = { start: string; end: string };

/** Узкий контекст для ночного precompute (передаётся сервисом как this). */
export interface PrecomputeNextDayContext {
  wbClustersRepository: {
    isConfigured(): boolean;
    getKnownCatalogNmIds(): Promise<number[]>;
    getCabinetClusterQueryCountsByNmId(nmIds: number[]): Promise<Map<number, number>>;
  };
  logger: { log(message: string): void; warn(message: string): void };
  formatAdvertisingSheetDate(value: Date): string;
  parseAdvertisingSheetDayValue(value: string): Date | null;
  addAdvertisingSheetDays(value: Date, days: number): Date;
  scheduleProductAdvertisingSheetWarmup(
    nmIds: number[],
    reason: string,
    explicitPeriod?: PrecomputePeriod | null,
    priority?: ProductSnapshotWarmupPriority,
  ): void;
}

export type PrecomputeGateResult = {
  /** Товары, безопасные для ночной материализации. */
  eligible: number[];
  /** Пропущенные монстры (отсортированы по убыванию числа строк). */
  skipped: { nmId: number; rows: number }[];
};

/**
 * Делит товары на «можно греть ночью» и «монстры — пропустить» по порогу строк
 * query-universe. nmId без данных в карте счётчиков считается 0 строк (eligible).
 */
export function partitionPrecomputeByQuerySize(
  nmIds: number[],
  queryCounts: Map<number, number>,
  maxRows: number,
): PrecomputeGateResult {
  const eligible: number[] = [];
  const skipped: { nmId: number; rows: number }[] = [];
  for (const nmId of nmIds) {
    const rows = queryCounts.get(nmId) ?? 0;
    if (rows > maxRows) {
      skipped.push({ nmId, rows });
    } else {
      eligible.push(nmId);
    }
  }
  skipped.sort((a, b) => b.rows - a.rows);
  return { eligible, skipped };
}

/** Строка для лога о пропущенных монстрах (топ-10 по размеру). */
export function describeSkippedMonsters(
  skipped: { nmId: number; rows: number }[],
  maxRows: number,
): string {
  const top = skipped
    .slice(0, 10)
    .map((s) => `${s.nmId}(${s.rows})`)
    .join(", ");
  return (
    `Ночной пре-компьютинг: пропущено ${skipped.length} товаров-монстров ` +
    `(>${maxRows} строк query-universe) во избежание heap OOM — материализуются ` +
    `on-demand при открытии. Топ: ${top}.`
  );
}

/**
 * Ночной precompute next-day периода: заранее материализует 7-дневный диапазон
 * следующего дня для всех товаров, КРОМЕ монстров (гейт по maxRows — иначе FATAL OOM).
 * Прогон серийный (priority "precompute" → concurrency 1). Вынесено из god-файла сервиса.
 */
export async function runPrecomputeNextDayPeriod(
  self: PrecomputeNextDayContext,
  maxRows: number,
): Promise<void> {
  if (!self.wbClustersRepository.isConfigured()) {
    return;
  }
  try {
    const allNmIds = await self.wbClustersRepository.getKnownCatalogNmIds();
    if (allNmIds.length === 0) {
      return;
    }
    const queryCounts =
      await self.wbClustersRepository.getCabinetClusterQueryCountsByNmId(allNmIds);
    const { eligible: nmIds, skipped } = partitionPrecomputeByQuerySize(
      allNmIds,
      queryCounts,
      maxRows,
    );
    if (skipped.length > 0) {
      self.logger.warn(describeSkippedMonsters(skipped, maxRows));
    }
    if (nmIds.length === 0) {
      return;
    }
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = self.formatAdvertisingSheetDate(
      self.parseAdvertisingSheetDayValue(self.formatAdvertisingSheetDate(tomorrow))!,
    );
    const weekStart = self.formatAdvertisingSheetDate(
      self.addAdvertisingSheetDays(self.parseAdvertisingSheetDayValue(tomorrowStr)!, -6),
    );
    const nextWeekPeriod = { start: weekStart, end: tomorrowStr };
    self.logger.log(
      `Ночной пре-компьютинг: материализация ${nextWeekPeriod.start}..${nextWeekPeriod.end} для ${nmIds.length} товаров.`,
    );
    self.scheduleProductAdvertisingSheetWarmup(
      nmIds,
      "precompute-next-day",
      nextWeekPeriod,
      "precompute",
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    self.logger.warn(`Ночной пре-компьютинг не удался: ${msg}`);
  }
}
