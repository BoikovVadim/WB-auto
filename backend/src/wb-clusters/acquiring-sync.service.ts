import { Inject, Injectable, Logger } from "@nestjs/common";

import { appEnv } from "../common/env";
import { WbRuntimeConfigService } from "../wb-sync/wb-runtime-config.service";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbStatisticsApiClient } from "./wb-statistics-api.client";

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Дата "YYYY-MM-DD" в МСК со сдвигом в днях (зеркало getMoscowDateStr god-сервиса). */
function moscowDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** День недели в МСК: 0=воскресенье … 6=суббота. */
function moscowDow(): number {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCDay();
}

/**
 * Синк фактического эквайринга из отчёта о реализации WB (reportDetailByPeriod).
 *
 * Тянет РОВНО последнюю закрытую отчётную неделю (Пн–Вс) — без длинного исторического
 * бэкфилла. Чистит только эту неделю и перезаписывает; прошлые недели не трогает, поэтому
 * ретроспектива накапливается сама вперёд (крон каждую неделю добавляет новую неделю).
 *
 * Вынесен в отдельный сервис (а не god-WbClustersService): своя ответственность.
 * Свой инстанс WbStatisticsApiClient → свой throttle (statistics-api: 1 req/min).
 * Крон в «тихое» окно (05:07 МСК), когда другие statistics-api синки не идут.
 */
@Injectable()
export class AcquiringSyncService {
  private readonly logger = new Logger(AcquiringSyncService.name);
  private running = false;

  private readonly statisticsApiClient = new WbStatisticsApiClient(
    () => this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken,
  );

  constructor(
    @Inject(WbClustersRepository)
    private readonly repository: WbClustersRepository,
    @Inject(WbRuntimeConfigService)
    private readonly wbRuntimeConfigService: WbRuntimeConfigService,
  ) {}

  /** Тянет последнюю закрытую отчётную неделю и перезаписывает её в wb_product_acquiring_weekly. */
  async syncAcquiringFromRealization(): Promise<void> {
    if (this.running) {
      this.logger.warn("Acquiring sync: предыдущий прогон ещё идёт, пропускаю тик.");
      return;
    }
    if (!this.repository.isConfigured()) return;
    await this.repository.ensureSchema();
    const token = this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken;
    if (!token) {
      this.logger.warn("Acquiring sync: WB_API_TOKEN не задан, пропуск.");
      return;
    }

    this.running = true;
    try {
      const daysSinceMonday = (moscowDow() + 6) % 7; // дней назад до понедельника текущей недели
      // Последняя ЗАКРЫТАЯ неделя: понедельник..воскресенье предыдущей недели.
      const weekFrom = moscowDateStr(-(daysSinceMonday + 7));
      const weekTo = moscowDateStr(-(daysSinceMonday + 1));
      this.logger.log(`Acquiring sync: последняя закрытая неделя ${weekFrom}..${weekTo}`);

      // Агрегируем по nm_id × отчётной неделе ПОСТРАНИЧНО (генератор отдаёт отчёт
      // частями) — так весь отчёт не висит в памяти, только маленький агрегат и одна
      // страница. acquiring_fee и retail_amount суммируем со знаком (возвраты
      // отрицательны) → net-эквайринг за неделю. Ошибка фетча в любой странице → warn и
      // выход без записи (агрегат отбрасываем, неделю не чистим — частичных данных нет).
      const agg = new Map<
        string,
        { nmId: number; weekStart: string; weekEnd: string; fee: number; retail: number }
      >();
      try {
        for await (const page of this.statisticsApiClient.iterateReportDetailByPeriod(weekFrom, weekTo)) {
          for (const r of page) {
            if (!r.nm_id || typeof r.date_from !== "string") continue;
            const weekStart = r.date_from.slice(0, 10);
            const weekEnd = typeof r.date_to === "string" ? r.date_to.slice(0, 10) : weekStart;
            const fee = Number(r.acquiring_fee) || 0;
            const retail = Number(r.retail_amount) || 0;
            const key = `${r.nm_id}|${weekStart}`;
            const entry = agg.get(key);
            if (entry) {
              entry.fee += fee;
              entry.retail += retail;
            } else {
              agg.set(key, { nmId: r.nm_id, weekStart, weekEnd, fee, retail });
            }
          }
        }
      } catch (err) {
        this.logger.warn(`Acquiring sync fetch error: ${(err as Error).message}`);
        return;
      }

      const upsertRows = Array.from(agg.values()).map((a) => ({
        nmId: a.nmId,
        weekStart: a.weekStart,
        weekEnd: a.weekEnd,
        acquiringFeeSum: round2(a.fee),
        retailAmountSum: round2(a.retail),
      }));

      // Чистим только эту неделю (убрать товары, которых больше нет в отчёте) и пишем.
      // Прошлые недели не трогаем — ретроспектива копится вперёд.
      await this.repository.clearAcquiringRange(weekFrom, weekTo);
      await this.repository.upsertAcquiringWeekly(upsertRows);
      this.logger.log(`Acquiring sync done: ${upsertRows.length} product-week rows`);
    } finally {
      this.running = false;
    }
  }
}
