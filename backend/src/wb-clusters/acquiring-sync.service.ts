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
   * nm_id × отчётной неделе и пишет в wb_product_acquiring_weekly ПОЧАНКОВО.
   *
   * daysBack = 21 (крон) с запасом покрывает последнюю закрытую отчётную неделю; для
   * истории ретроспективы запускают бэкфилл с большим daysBack (например 180).
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

      // Тянем окно чанками <=30 дней, без перекрытия, и пишем КАЖДЫЙ чанк в БД сразу
      // (а не одним upsert'ом в конце). Зачем почанково: бэкенд периодически
      // перезапускается, и запись в конце теряла весь прогон при рестарте; почанковая
      // запись делает бэкфилл рестарт-устойчивым. Неделю чистим один раз за прогон
      // (clearedWeeks), дальше копим через addAcquiringWeekly (+=) — неделя на стыке
      // чанков складывается из частей, пере-синк не двоит.
      const CHUNK_DAYS = 30;
      const clearedWeeks = new Set<string>();
      let totalRows = 0;

      for (let toOffset = 0; toOffset < daysBack; ) {
        const fromOffset = Math.min(daysBack, toOffset + CHUNK_DAYS - 1);
        const chunkFrom = moscowDateStr(-fromOffset);
        const chunkTo = moscowDateStr(-toOffset);

        // Самый свежий чанк (toOffset === 0) ВСЕГДА тянем — WB доуточняет недавние
        // отчёты, нужно освежать последнюю неделю. Старые чанки, по которым данные уже
        // есть, ПРОПУСКАЕМ (без запроса/throttle): это делает бэкфилл возобновляемым —
        // повторный запуск за секунды доходит до первого незалитого месяца, переживая
        // частые перезапуски процесса.
        if (toOffset > 0 && (await this.repository.hasAcquiringDataInRange(chunkFrom, chunkTo))) {
          this.logger.log(`Acquiring sync chunk ${chunkFrom}..${chunkTo}: уже есть, пропуск`);
          toOffset = fromOffset + 1;
          continue;
        }

        // Агрегат ТОЛЬКО этого чанка (память ограничена одним окном). acquiring_fee и
        // retail_amount суммируем со знаком (возвраты отрицательны) -> net за неделю.
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

        // Чистим каждую затронутую неделю один раз за прогон, затем накапливаем чанк.
        const weeksInChunk = new Set<string>();
        for (const e of chunkAgg.values()) weeksInChunk.add(e.weekStart);
        for (const w of weeksInChunk) {
          if (!clearedWeeks.has(w)) {
            await this.repository.clearAcquiringWeek(w);
            clearedWeeks.add(w);
          }
        }

        const chunkRows = Array.from(chunkAgg.values()).map((a) => ({
          nmId: a.nmId,
          weekStart: a.weekStart,
          weekEnd: a.weekEnd,
          acquiringFeeSum: round2(a.fee),
          retailAmountSum: round2(a.retail),
        }));
        await this.repository.addAcquiringWeekly(chunkRows);
        totalRows += chunkRows.length;
        this.logger.log(
          `Acquiring sync chunk ${chunkFrom}..${chunkTo}: ${chunkRows.length} product-week rows`,
        );

        toOffset = fromOffset + 1;
      }

      this.logger.log(`Acquiring sync done: ${totalRows} product-week rows total`);
    } finally {
      this.running = false;
    }
  }
}
