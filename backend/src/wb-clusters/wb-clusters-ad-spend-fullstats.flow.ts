import { appEnv } from "../common/env";
import type { PromotionFullstatsResponse } from "./wb-clusters.types";
import type { WbClustersRepository } from "./wb-clusters.repository";

// Локальный any-alias, как в остальных phase/flow-файлах: даёт доступ к
// protected-полям сервиса (wbClustersRepository, wbPromotionApiClient,
// wbRuntimeConfigService, logger, getStatsPeriod, chunkArray) без отдельного
// контекст-интерфейса.
type WbClustersService = any;
type StoredCampaignInventoryEntry =
  Awaited<ReturnType<WbClustersRepository["getStoredCampaignInventory"]>>[number];

/**
 * Тянет ПОЛНЫЙ расход рекламы из WB /adv/v2/fullstats (как в кабинете) и пишет
 * в wb_advert_daily_spend по (advert × товар × день). Запускается часовым кроном
 * отдельно от основного 10-мин синка: у fullstats жёсткий лимит 1 запрос/мин,
 * до 100 кампаний за запрос.
 */
export async function runAdSpendFullstatsSync(self: WbClustersService): Promise<void> {
  if (!appEnv.wbPromotionSyncEnabled) return;
  if (!self.wbClustersRepository.isConfigured()) return;
  if (self.wbRuntimeConfigService.getPromotionTokenSource() === "missing") {
    self.logger.warn("Ad-spend fullstats sync: WB_PROMOTION_API_TOKEN не настроен, пропускаю.");
    return;
  }
  await self.wbClustersRepository.ensureSchema();

  const inventory: StoredCampaignInventoryEntry[] =
    await self.wbClustersRepository.getStoredCampaignInventory();
  const currencyByAdvertId = new Map<number, string | null>();
  const advertIds: number[] = [];
  for (const item of inventory) {
    advertIds.push(item.advertId);
    currencyByAdvertId.set(item.advertId, item.currency);
  }
  if (advertIds.length === 0) {
    self.logger.log("Ad-spend fullstats sync: нет кампаний в инвентаре, пропускаю.");
    return;
  }

  const period = self.getStatsPeriod();
  self.logger.log(
    `Ad-spend fullstats sync: ${advertIds.length} кампаний, период ${period.from} → ${period.to}`,
  );

  // Накопитель расхода по (advert, nm, date). fullstats дробит расход по
  // площадкам (apps), поэтому суммируем nm.sum по всем apps одного дня.
  const spendByKey = new Map<
    string,
    { advertId: number; nmId: number; statDate: string; spend: number }
  >();
  let chunksFailed = 0;

  const chunks = self.chunkArray(advertIds, appEnv.wbPromotionFullstatsChunkSize) as number[][];
  for (const chunk of chunks) {
    let response: PromotionFullstatsResponse | null = null;
    try {
      response = await self.wbPromotionApiClient.getFullstats({
        advertIds: chunk,
        from: period.from,
        to: period.to,
      });
    } catch (err) {
      chunksFailed += 1;
      self.logger.warn(
        `Ad-spend fullstats sync: чанк (${chunk[0]}…${chunk[chunk.length - 1]}) ошибка: ${
          (err as Error).message
        }`,
      );
      continue;
    }

    for (const campaign of response ?? []) {
      const advertId = Number(campaign.advertId);
      if (!Number.isFinite(advertId)) continue;
      for (const day of campaign.days ?? []) {
        const statDate = String(day.date).slice(0, 10);
        if (statDate.length !== 10) continue;
        for (const app of day.apps ?? []) {
          for (const nm of app.nm ?? []) {
            const nmId = Number(nm.nmId);
            const sum = Number(nm.sum);
            if (!Number.isFinite(nmId) || !Number.isFinite(sum)) continue;
            const key = `${advertId}|${nmId}|${statDate}`;
            const existing = spendByKey.get(key);
            if (existing) {
              existing.spend += sum;
            } else {
              spendByKey.set(key, { advertId, nmId, statDate, spend: sum });
            }
          }
        }
      }
    }
  }

  const rows = Array.from(spendByKey.values()).map((r) => ({
    advertId: r.advertId,
    nmId: r.nmId,
    statDate: r.statDate,
    spend: r.spend,
    currency: currencyByAdvertId.get(r.advertId) ?? null,
  }));

  const upserted = await self.wbClustersRepository.upsertAdvertDailySpend(rows);
  self.logger.log(
    `Ad-spend fullstats sync done: ${upserted} строк (advert×товар×день)` +
      (chunksFailed > 0 ? `, чанков с ошибкой: ${chunksFailed}` : ""),
  );
}
