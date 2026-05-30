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

const WEEKS_PER_CHUNK = 4;

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
   * Тянет отчёт о реализации за последние ~`daysBack` дней (округляется до недель),
   * агрегирует эквайринг по nm_id × отчётной неделе и пишет в wb_product_acquiring_weekly.
   *
   * Чанки выровнены по границам недель (Пн–Вс) и идут от свежих к старым:
   *   - неделя целиком попадает в один чанк → нет стыковых частей, перезапись идемпотентна;
   *   - каждый чанк пишется в БД сразу (рестарт-устойчивость: завершённые чанки переживают
   *     частые перезапуски процесса);
   *   - самый свежий чанк тянется всегда (WB доуточняет недавние отчёты), а старые чанки с
   *     уже залитыми данными ПРОПУСКАЮТСЯ без запроса → бэкфилл возобновляемый: повторный
   *     запуск за секунды доходит до первого незалитого месяца.
   *
   * daysBack = 21 (крон) с запасом покрывает последнюю закрытую неделю; для истории
   * ретроспективы запускают бэкфилл с большим daysBack (например 180).
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
      const daysSinceMonday = (moscowDow() + 6) % 7; // дней назад до понедельника этой недели
      const weeksToFetch = Math.max(1, Math.ceil(daysBack / 7));
      const numChunks = Math.ceil(weeksToFetch / WEEKS_PER_CHUNK);
      this.logger.log(`Acquiring sync: ${weeksToFetch} недель назад, ${numChunks} чанков по ${WEEKS_PER_CHUNK}`);

      let totalRows = 0;
      for (let c = 0; c < numChunks; c++) {
        const newestWeek = c * WEEKS_PER_CHUNK; // 0 = текущая неделя
        const oldestWeek = Math.min(weeksToFetch - 1, newestWeek + WEEKS_PER_CHUNK - 1);
        const fromOffset = daysSinceMonday + oldestWeek * 7; // понедельник самой старой недели чанка
        const toOffset = Math.max(0, daysSinceMonday + newestWeek * 7 - 6); // воскресенье самой свежей (≤ сегодня)
        const chunkFrom = moscowDateStr(-fromOffset);
        const chunkTo = moscowDateStr(-toOffset);

        // Старый чанк с уже залитыми данными пропускаем без запроса (без throttle).
        if (c > 0 && (await this.repository.hasAcquiringDataInRange(chunkFrom, chunkTo))) {
          this.logger.log(`Acquiring sync chunk ${chunkFrom}..${chunkTo}: уже есть, пропуск`);
          continue;
        }

        // Агрегат ТОЛЬКО этого чанка (память ограничена одним окном). acquiring_fee и
        // retail_amount суммируем со знаком (возвраты отрицательны) → net за неделю.
        const chunkAgg = new Map<
          string,
          { nmId: number; weekStart: string; weekEnd: string; fee: number; retail: number }
        >();
        try {
          const rows = await this.statisticsApiClient.fetchReportDetailByPeriod(chunkFrom, chunkTo);
          for (const r of rows) {
            if (!r.nm_id || typeof r.date_from !== "string") continue;
            const weekStart = r.date_from.slice(0, 10);
            const weekEnd = typeof r.date_to === "string" ? r.date_to.slice(0, 10) : weekStart;
            const fee = Number(r.acquiring_fee) || 0;
            const retail = Number(r.retail_amount) || 0;
            const key = `${r.nm_id}|${weekStart}`;
            const entry = chunkAgg.get(key);
            if (entry) {
              entry.fee += fee;
              entry.retail += retail;
            } else {
              chunkAgg.set(key, { nmId: r.nm_id, weekStart, weekEnd, fee, retail });
            }
          }
        } catch (err) {
          this.logger.warn(
            `Acquiring sync fetch error (${chunkFrom}..${chunkTo}): ${(err as Error).message}`,
          );
          return;
        }

        const chunkRows = Array.from(chunkAgg.values()).map((a) => ({
          nmId: a.nmId,
          weekStart: a.weekStart,
          weekEnd: a.weekEnd,
          acquiringFeeSum: round2(a.fee),
          retailAmountSum: round2(a.retail),
        }));
        // Чистим недели чанка (убрать строки товаров, которых больше нет в отчёте), затем
        // перезаписываем. Чанки не делят недель, поэтому чистка по диапазону точна.
        await this.repository.clearAcquiringRange(chunkFrom, chunkTo);
        await this.repository.upsertAcquiringWeekly(chunkRows);
        totalRows += chunkRows.length;
        this.logger.log(
          `Acquiring sync chunk ${chunkFrom}..${chunkTo}: ${chunkRows.length} product-week rows`,
        );
      }

      this.logger.log(`Acquiring sync done: ${totalRows} product-week rows total`);
    } finally {
      this.running = false;
    }
  }
}
