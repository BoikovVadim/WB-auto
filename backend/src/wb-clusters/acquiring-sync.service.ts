import { Inject, Injectable, Logger } from "@nestjs/common";

import { appEnv } from "../common/env";
import { WbRuntimeConfigService } from "../wb-sync/wb-runtime-config.service";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbStatisticsApiClient, type WbReportDetailRow } from "./wb-statistics-api.client";

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Дата "YYYY-MM-DD" в МСК со сдвигом в днях (зеркало getMoscowDateStr god-сервиса). */
function moscowDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Синк фактического эквайринга из отчёта о реализации WB (reportDetailByPeriod).
 *
 * Вынесен в отдельный сервис (а не в god-WbClustersService): своя ответственность —
 * скачать отчёт, агрегировать эквайринг по nm_id × отчётной неделе, записать в
 * wb_product_acquiring_weekly. Юнит-экономика читает результат через репозиторий.
 *
 * Свой инстанс WbStatisticsApiClient → свой throttle (statistics-api: 1 req/min).
 * Крон стоит в «тихое» окно (05:07 МСК), когда другие statistics-api синки (orders
 * :00/:15/:30/:45, spp в :00, stocks/prices ночью) не идут, чтобы не делить лимит.
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

  /**
   * Тянет отчёт о реализации за последние `daysBack` дней, агрегирует эквайринг по
   * nm_id × отчётной неделе (week_start = date_from отчёта) и upsert-ит в
   * wb_product_acquiring_weekly. Перед записью чистит затронутый диапазон недель,
   * чтобы пересчёт/отзыв строк на стороне WB не оставил устаревших значений.
   *
   * daysBack = 21 с запасом покрывает последнюю закрытую отчётную неделю (пн–вс),
   * даже если отчёт публикуется/уточняется с задержкой в несколько дней.
   */
  async syncAcquiringFromRealization(daysBack = 21): Promise<void> {
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
      this.logger.log(
        `Acquiring sync: ${moscowDateStr(-daysBack)}..${moscowDateStr(0)} (Moscow), daysBack=${daysBack}`,
      );

      // Агрегируем по nm_id × отчётной неделе. acquiring_fee и retail_amount суммируем
      // со знаком (возвраты приходят отрицательными) → net-эквайринг за неделю.
      const agg = new Map<
        string,
        { nmId: number; weekStart: string; weekEnd: string; fee: number; retail: number }
      >();
      let minWeekStart: string | null = null;
      const addRow = (r: WbReportDetailRow) => {
        if (!r.nm_id || typeof r.date_from !== "string") return;
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
        if (minWeekStart === null || weekStart < minWeekStart) minWeekStart = weekStart;
      };

      // Тянем окно чанками ≤30 дней, без перекрытия: у reportDetailByPeriod ограничен
      // период за запрос, а бэкфилл истории (для ретроспективы) бывает длинным. Агрегат
      // по (nm_id, отчётная неделя) копится в один Map между чанками — недели на стыке
      // не теряются и не двоятся (границы окон не пересекаются).
      const CHUNK_DAYS = 30;
      for (let toOffset = 0; toOffset < daysBack; ) {
        const fromOffset = Math.min(daysBack, toOffset + CHUNK_DAYS - 1);
        const chunkFrom = moscowDateStr(-fromOffset);
        const chunkTo = moscowDateStr(-toOffset);
        try {
          const rows = await this.statisticsApiClient.fetchReportDetailByPeriod(chunkFrom, chunkTo);
          for (const r of rows) addRow(r);
        } catch (err) {
          this.logger.warn(
            `Acquiring sync fetch error (${chunkFrom}..${chunkTo}): ${(err as Error).message}`,
          );
          return;
        }
        toOffset = fromOffset + 1;
      }

      const upsertRows = Array.from(agg.values()).map((a) => ({
        nmId: a.nmId,
        weekStart: a.weekStart,
        weekEnd: a.weekEnd,
        acquiringFeeSum: round2(a.fee),
        retailAmountSum: round2(a.retail),
      }));

      if (minWeekStart) await this.repository.clearAcquiringWeeklyFrom(minWeekStart);
      if (upsertRows.length > 0) await this.repository.upsertAcquiringWeekly(upsertRows);
      this.logger.log(`Acquiring sync done: ${upsertRows.length} product-week rows`);
    } finally {
      this.running = false;
    }
  }
}
