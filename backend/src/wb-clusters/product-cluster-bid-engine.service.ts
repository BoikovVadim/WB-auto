import { Injectable, Logger } from "@nestjs/common";

import { ProductCpoService } from "./product-cpo.service";
import { ProductPositionService } from "./product-position.service";
import {
  computeBidCap,
  computeClusterCr,
  computeDesiredBid,
  isUnprofitableAtMin,
  parseMinSearchBid,
  BID_TARGET_POSITION,
  type BidEngineParams,
} from "./product-cluster-bid";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbClustersService } from "./wb-clusters.service";
import { WbPromotionApiClient } from "./wb-promotion-api.client";

/** Конфигурация ставочного движка из env (все параметры — открытые, калибруются на обкатке). */
interface BidEngineConfig extends BidEngineParams {
  /** Движок включён (считает + зондирует scope; пишет наблюдение). */
  engine: boolean;
  /** Применять ли ставки на WB реально (false = dry-run: только наблюдение). */
  applyToWb: boolean;
  /** scope товаров: 'all' или множество nmId. Вне scope движок товар не трогает. */
  scopeAll: boolean;
  scopeNmIds: Set<number>;
  /** Порог значимости изменения ставки (₽) — не шлём микро-правки на WB. */
  minDeltaToApply: number;
}

function numEnv(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

function readConfig(): BidEngineConfig {
  const raw = (process.env.WB_CLUSTER_BID_NMIDS ?? "").trim();
  const scopeAll = raw.toLowerCase() === "all";
  const scopeNmIds = new Set(
    scopeAll
      ? []
      : raw
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0),
  );
  return {
    engine: process.env.WB_CLUSTER_BID_ENGINE === "1",
    applyToWb: process.env.WB_CLUSTER_BID_DRY_RUN !== "1",
    scopeAll,
    scopeNmIds,
    minBid: numEnv("WB_CLUSTER_BID_MIN", 100),
    maxWbBid: numEnv("WB_CLUSTER_BID_MAX", 5000),
    // Разгон до топ-4: +10% от текущей за круг. В топ-4: точный шаг вниз 10 ₽.
    coarsePct: numEnv("WB_CLUSTER_BID_COARSE_PCT", 0.1),
    fineStep: numEnv("WB_CLUSTER_BID_FINE_STEP", 10),
    minDeltaToApply: numEnv("WB_CLUSTER_BID_MIN_DELTA", 1),
  };
}

/**
 * Ставочный движок (этап 3): позиционный регулятор ставок CPM заказных кластеров.
 *
 * По кругу (крон, busy-guard) для товаров из scope: для каждого заказного кластера зондирует
 * позицию С РЕКЛАМОЙ, считает желаемую ставку (computeDesiredBid: к топ-4, асимметрично, под
 * потолком bid_cap), пишет наблюдение (позиция/желаемая/причина) и — только для scope и не в
 * dry-run — применяет ставку на WB через applyProductClusterBids (очередь bid-write).
 *
 * БЕЗОПАСНОСТЬ: по умолчанию движок ВЫКЛЮЧЕН (WB_CLUSTER_BID_ENGINE≠1) и scope ПУСТ — ничего
 * не делает. Точечный тест: WB_CLUSTER_BID_ENGINE=1 + WB_CLUSTER_BID_NMIDS="<nmId>"; для самой
 * первой обкатки без записи на WB — WB_CLUSTER_BID_DRY_RUN=1. Масштаб — NMIDS="all".
 * См. product-cluster-bid.ts и docs/cluster-ad-strategy.md.
 */
@Injectable()
export class ProductClusterBidEngineService {
  private readonly logger = new Logger("ProductClusterBidEngine");
  private busy = false;

  constructor(
    private readonly repository: WbClustersRepository,
    private readonly productCpoService: ProductCpoService,
    private readonly positionService: ProductPositionService,
    private readonly wbClustersService: WbClustersService,
    private readonly promotionClient: WbPromotionApiClient,
  ) {}

  /**
   * Минимальная ставка WB кампании-товара (₽). Если в БД ещё нет (не синкалась) — лениво
   * тянем из WB /api/advert/v1/bids/min, сохраняем в min_search_bid и используем. Это и есть
   * «реальная минимальная ставка товара», от которой движок отталкивается (шаг и нижняя граница).
   */
  private async ensureMinBid(
    advertId: number,
    nmId: number,
    bounds: { minSearchBid: number | null; paymentType: string | null },
  ): Promise<number | null> {
    if (bounds.minSearchBid != null) return bounds.minSearchBid;
    if (!bounds.paymentType) return null;
    try {
      const resp = await this.promotionClient.getMinimumProductBids({
        advert_id: advertId,
        nm_ids: [nmId],
        payment_type: bounds.paymentType,
        placement_types: ["search"],
      });
      const min = parseMinSearchBid(resp, nmId);
      if (min != null) {
        await this.repository.upsertCampaignProductMinSearchBids([
          { advertId, nmId, minSearchBid: min },
        ]);
      }
      return min;
    } catch (err) {
      this.logger.warn(`min-bid sync ${advertId}/${nmId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Предложения движка по управляемым кластерам кампании (для модалки наблюдения): замеренная
   * позиция, текущая ставка, желаемая ставка, потолок bid_cap, причина. Только кластеры, по
   * которым движок что-то посчитал (есть желаемая ставка или bid_cap).
   */
  async getBidSuggestions(advertId: number, nmId: number) {
    const [states, cpoInputs, bounds] = await Promise.all([
      this.repository.getManagedClusterAutomationStates(advertId, nmId),
      this.repository.getClusterCpoInputs(advertId, nmId),
      this.repository.getCampaignBidBounds(advertId, nmId),
    ]);
    // Базовая ставка кампании — то, что действует у кластера без своей ставки (для отображения).
    const baseBid = bounds.searchBid ?? bounds.minSearchBid;
    // Только АКТИВНЫЕ на WB кластеры (как таб «Активные»): движок крутит ставки только их;
    // у неактивных может остаться stale-предложение в state — не показываем.
    const activeNcn = new Set(
      cpoInputs.filter((i) => i.currentSourceKind === "active").map((i) => i.normalizedClusterName),
    );
    // Только кластеры с РЕАЛЬНЫМ предложением движка (посчитана желаемая ставка).
    const withBid = states.filter(
      (s) => s.lastDesiredBid !== null && activeNcn.has(s.normalizedClusterName),
    );
    const currentBids = await this.repository.getCurrentClusterBids(
      nmId,
      advertId,
      withBid.map((s) => s.normalizedClusterName),
    );
    return {
      clusters: withBid.map((s) => ({
        normalizedClusterName: s.normalizedClusterName,
        state: s.state,
        position: s.lastPosition,
        currentBid: currentBids.get(s.normalizedClusterName) ?? baseBid,
        desiredBid: s.lastDesiredBid,
        bidCap: s.lastBidCap,
        reason: s.lastBidReason,
      })),
    };
  }

  /** Один круг движка по товарам из scope. Busy-guard: длинный круг не накладывается сам на себя. */
  async runCycle(): Promise<void> {
    const cfg = readConfig();
    if (!cfg.engine) return;
    if (cfg.scopeAll === false && cfg.scopeNmIds.size === 0) return; // scope пуст — нечего делать
    if (this.busy) {
      this.logger.log("предыдущий круг ещё идёт — пропуск (растянутый круг).");
      return;
    }
    this.busy = true;
    const startedAt = Date.now();
    let processed = 0;
    let applied = 0;
    try {
      const enabled = await this.repository.listEnabledAutomations();
      const inScope = enabled.filter((a) => cfg.scopeAll || cfg.scopeNmIds.has(a.nmId));
      for (const a of inScope) {
        try {
          const r = await this.regulateCampaign(a.advertId, a.nmId, cfg);
          processed += r.processed;
          applied += r.applied;
        } catch (err) {
          this.logger.warn(`bid ${a.advertId}/${a.nmId}: ${(err as Error).message}`);
        }
      }
      // Телеметрия круга (этап 5): длительность / обработано / применено. Сигнал, если круг
      // дольше целевого времени — пора добавить параллельный зонд/IP/батчинг (не деградирует молча).
      const durMs = Date.now() - startedAt;
      const targetMs = numEnv("WB_CLUSTER_BID_CYCLE_TARGET_MS", 31 * 60_000);
      const summary =
        `круг ${Math.round(durMs / 1000)}с: товаров ${inScope.length}, ` +
        `кластеров ${processed}, применено ставок ${applied}` +
        (cfg.applyToWb ? "" : " (DRY-RUN)");
      if (durMs > targetMs) {
        this.logger.warn(
          `${summary} — ПРЕВЫШЕНО целевое время ${Math.round(targetMs / 1000)}с: ` +
            `добавить параллельный зонд/IP или батчинг.`,
        );
      } else {
        this.logger.log(summary);
      }
    } finally {
      this.busy = false;
    }
  }

  private async regulateCampaign(
    advertId: number,
    nmId: number,
    cfg: BidEngineConfig,
  ): Promise<{ processed: number; applied: number }> {
    const [cpoInputs, productCpo, bounds, states] = await Promise.all([
      this.repository.getClusterCpoInputs(advertId, nmId),
      this.productCpoService.getProductCpo(nmId),
      this.repository.getCampaignBidBounds(advertId, nmId),
      this.repository.getManagedClusterAutomationStates(advertId, nmId),
    ]);
    // Достигал ли кластер топ-4 ранее (фаза: разгон до 1-го топа → потом точный шаг ±10₽).
    const reachedByNcn = new Map(states.map((s) => [s.normalizedClusterName, s.lastReachedTop]));
    const maxCpo = productCpo.maxCpo;
    // Нижняя граница — РЕАЛЬНЫЙ минимум WB кампании (лениво синкаем, если в БД ещё нет;
    // env-дефолт только если WB совсем не отдал). Базовая ставка кампании — то, что действует
    // у кластера без своей ставки (стартовая точка).
    const minBid = (await this.ensureMinBid(advertId, nmId, bounds)) ?? cfg.minBid;
    const baseBid = bounds.searchBid ?? minBid;
    const params: BidEngineParams = {
      minBid,
      maxWbBid: cfg.maxWbBid,
      coarsePct: cfg.coarsePct,
      fineStep: cfg.fineStep,
    };

    // Заказные АКТИВНЫЕ кластеры за РЕАЛЬНЫЕ 30 дней (max(РК,JAM) > 0 и активны на WB). CR и
    // bid_cap считаем от реальных показов за 30 дней (cpoInputs.views), не от накопителя.
    const ordered = cpoInputs.filter(
      (i) =>
        Math.max(i.shks ?? i.ordersRk, i.ordersJam) > 0 && i.currentSourceKind === "active",
    );
    if (ordered.length === 0) return { processed: 0, applied: 0 };

    const names = ordered.map((i) => i.normalizedClusterName);
    const currentBids = await this.repository.getCurrentClusterBids(nmId, advertId, names);

    const toApply: { clusterName: string; bid: number }[] = [];
    let processed = 0;
    for (const input of ordered) {
      const ncn = input.normalizedClusterName;
      const clusterName = input.clusterName;
      const cr = computeClusterCr({
        accruedOrdersRk: input.shks ?? input.ordersRk,
        accruedOrdersJam: input.ordersJam,
        accruedViews: input.views,
      });
      const bidCap = computeBidCap(maxCpo, cr);
      // Текущая ставка: своя кластерная, иначе базовая ставка кампании (не выдуманный минимум).
      const currentBid = currentBids.get(ncn) ?? baseBid;
      const prevReachedTop = reachedByNcn.get(ncn) ?? false;

      // Убыточен даже на минимуме (bid_cap < мин) — не качаем ставку (кандидат на отключение
      // по конверсии; отключение делает ДРР/базовое правило, не ставочный движок).
      if (isUnprofitableAtMin(bidCap, minBid)) {
        await this.repository.updateClusterBidObservation(advertId, nmId, ncn, {
          position: null,
          desiredBid: null,
          reason: "unprofitable",
          reachedTop: prevReachedTop,
        });
        processed++;
        continue;
      }

      // Зонд позиции С РЕКЛАМОЙ по топ-100 (сериализован в probe-клиенте; 429/сбой → retry внутри).
      const snap = await this.positionService.probeCluster(nmId, clusterName, 100);
      // found → реальная позиция; not_found → товара нет в топ-100 → место >100 (глубоко выпал,
      // разгоняем ставку); blocked/throttled/error → замер не удался → null (frozen, повтор
      // на следующем круге обхода — анти-бот к тому времени отпустит / IP сменится).
      const position =
        snap.status === "found"
          ? snap.organicPosition
          : snap.status === "not_found"
            ? (snap.scannedCount ?? 100) + 1
            : null;
      const desired = computeDesiredBid({ position, currentBid, bidCap }, params);
      // Флаг «был в топ-4» — наблюдательный (на логику ставки не влияет): правило простое —
      // P>4 поднимаем %, P≤4 спускаем по 10₽. Храним факт достижения топа для аналитики.
      const reachedTop = prevReachedTop || (position !== null && position <= BID_TARGET_POSITION);

      await this.repository.updateClusterBidObservation(advertId, nmId, ncn, {
        position,
        desiredBid: desired.bid,
        reason: desired.reason,
        reachedTop,
      });
      processed++;

      if (Math.abs(desired.bid - currentBid) >= cfg.minDeltaToApply) {
        toApply.push({ clusterName, bid: desired.bid });
      }
    }

    // Применяем на WB только в scope и не в dry-run. Тип кампании (manual+cpm) проверяет
    // applyProductClusterBids — при несовместимости бросит, ловим и продолжаем.
    let applied = 0;
    if (cfg.applyToWb && toApply.length > 0) {
      try {
        await this.wbClustersService.applyProductClusterBids(nmId, advertId, toApply);
        applied = toApply.length;
        this.logger.log(`применено ставок ${applied} для ${advertId}/${nmId}`);
      } catch (err) {
        this.logger.warn(`apply bids ${advertId}/${nmId}: ${(err as Error).message}`);
      }
    }
    return { processed, applied };
  }
}
