import { appEnv } from "../common/env";
import type {
  PromotionAdvUpdResponse,
  PromotionFullstatsResponse,
} from "./wb-clusters.types";

// Локальный any-alias, как в остальных phase/flow-файлах: даёт доступ к
// protected-полям сервиса (wbClustersRepository, wbPromotionApiClient,
// wbRuntimeConfigService, logger, getStatsPeriod, chunkArray) без отдельного
// контекст-интерфейса.
type WbClustersService = any;

/**
 * Тянет ПОЛНЫЙ расход рекламы из WB GET /adv/v3/fullstats (как в кабинете) и
 * пишет в wb_advert_daily_spend по (advert × товар × день). Запускается часовым
 * кроном отдельно от основного 10-мин синка.
 *
 * Чтобы уложиться в суточный лимит fullstats (~200 запросов/аккаунт) и не гонять
 * тысячу кампаний инвентаря, сначала одним дешёвым запросом /adv/v1/upd (история
 * затрат) узнаём, у каких РК реально был расход за период, и fullstats зовём
 * только по ним. На практике это ~80 кампаний из ~1000 → 2 запроса fullstats.
 */
export async function runAdSpendFullstatsSync(self: WbClustersService): Promise<void> {
  if (!appEnv.wbPromotionSyncEnabled) return;
  if (!self.wbClustersRepository.isConfigured()) return;
  if (self.wbRuntimeConfigService.getPromotionTokenSource() === "missing") {
    self.logger.warn("Ad-spend fullstats sync: WB_PROMOTION_API_TOKEN не настроен, пропускаю.");
    return;
  }
  await self.wbClustersRepository.ensureSchema();

  const period = self.getStatsPeriod();

  // Шаг 1 — дешёвый pre-filter: /adv/v1/upd отдаёт список списаний за период.
  // Берём кампании с расходом (updSum > 0); валюту тоже из upd.
  let updResponse: PromotionAdvUpdResponse | null = null;
  try {
    updResponse = await self.wbPromotionApiClient.getAdvUpd({
      from: period.from,
      to: period.to,
    });
  } catch (err) {
    self.logger.warn(`Ad-spend fullstats sync: /adv/v1/upd ошибка: ${(err as Error).message}`);
    return;
  }

  const currencyByAdvertId = new Map<number, string | null>();
  const spentAdvertIds = new Set<number>();
  for (const rec of updResponse ?? []) {
    const advertId = Number(rec.advertId);
    if (!Number.isFinite(advertId)) continue;
    if (Number(rec.updSum) > 0) {
      spentAdvertIds.add(advertId);
      if (rec.currency && !currencyByAdvertId.has(advertId)) {
        currencyByAdvertId.set(advertId, rec.currency);
      }
    }
  }
  const advertIds = Array.from(spentAdvertIds);
  if (advertIds.length === 0) {
    self.logger.log(
      "Ad-spend fullstats sync: за период не было расходов (по /adv/v1/upd), пропускаю.",
    );
    return;
  }

  self.logger.log(
    `Ad-spend fullstats sync: ${advertIds.length} кампаний с расходом (из /adv/v1/upd), период ${period.from} → ${period.to}`,
  );

  // Шаг 2 — полный расход с разбивкой по товарам. fullstats дробит расход по
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
