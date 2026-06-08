import { Injectable, Logger } from "@nestjs/common";

import { ProductClusterAccrualService } from "./product-cluster-accrual.service";
import { ProductCpoService } from "./product-cpo.service";
import { ProductPositionService } from "./product-position.service";
import {
  computeBidCap,
  computeClusterCr,
  computeDesiredBid,
  isUnprofitableAtMin,
  type BidEngineParams,
} from "./product-cluster-bid";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbClustersService } from "./wb-clusters.service";

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
    // Шаг = доля от минимальной ставки за круг (0.1 = 10% от minBid), фикс, симметрично.
    stepFrac: numEnv("WB_CLUSTER_BID_STEP_PCT", 0.1),
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
    private readonly accrualService: ProductClusterAccrualService,
    private readonly positionService: ProductPositionService,
    private readonly wbClustersService: WbClustersService,
  ) {}

  /**
   * Предложения движка по управляемым кластерам кампании (для модалки наблюдения): замеренная
   * позиция, текущая ставка, желаемая ставка, потолок bid_cap, причина. Только кластеры, по
   * которым движок что-то посчитал (есть желаемая ставка или bid_cap).
   */
  async getBidSuggestions(advertId: number, nmId: number) {
    const [states, cpoInputs] = await Promise.all([
      this.repository.getManagedClusterAutomationStates(advertId, nmId),
      this.repository.getClusterCpoInputs(advertId, nmId),
    ]);
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
        currentBid: currentBids.get(s.normalizedClusterName) ?? null,
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
    const params: BidEngineParams = {
      minBid: cfg.minBid,
      maxWbBid: cfg.maxWbBid,
      stepFrac: cfg.stepFrac,
    };
    const [accrual, cpoInputs, productCpo] = await Promise.all([
      this.accrualService.loadCurrentBucketAccrual(advertId, nmId),
      this.repository.getClusterCpoInputs(advertId, nmId),
      this.productCpoService.getProductCpo(nmId),
    ]);
    const maxCpo = productCpo.maxCpo;
    const nameByNcn = new Map(cpoInputs.map((i) => [i.normalizedClusterName, i.clusterName]));
    // Реальное состояние кластера на WB ('active' = показывается сейчас). Ставку крутим ТОЛЬКО
    // для активных — выключенные/чёрный список/чужие (есть случайные заказы в accrual, но не в
    // составе РК) не зондируем и не трогаем.
    const sourceByNcn = new Map(cpoInputs.map((i) => [i.normalizedClusterName, i.currentSourceKind]));

    // Заказные АКТИВНЫЕ кластеры текущей корзины (max(РК,JAM) > 0 и активны на WB).
    const ordered = [...accrual.entries()].filter(
      ([ncn, acc]) =>
        Math.max(acc.accruedOrdersRk, acc.accruedOrdersJam) > 0 &&
        sourceByNcn.get(ncn) === "active",
    );
    if (ordered.length === 0) return { processed: 0, applied: 0 };

    const names = ordered.map(([ncn]) => ncn);
    const currentBids = await this.repository.getCurrentClusterBids(nmId, advertId, names);

    const toApply: { clusterName: string; bid: number }[] = [];
    let processed = 0;
    for (const [ncn, acc] of ordered) {
      const clusterName = nameByNcn.get(ncn) ?? ncn;
      const cr = computeClusterCr(acc);
      const bidCap = computeBidCap(maxCpo, cr);
      const currentBid = currentBids.get(ncn) ?? cfg.minBid;

      // Убыточен даже на минимуме (bid_cap < мин) — не качаем ставку (кандидат на отключение
      // по конверсии; отключение делает ДРР/базовое правило, не ставочный движок).
      if (isUnprofitableAtMin(bidCap, cfg.minBid)) {
        await this.repository.updateClusterBidObservation(advertId, nmId, ncn, {
          position: null,
          desiredBid: null,
          reason: "unprofitable",
        });
        processed++;
        continue;
      }

      // Зонд позиции С РЕКЛАМОЙ (сериализован в probe-клиенте; 429/сбой → retry внутри).
      const snap = await this.positionService.probeCluster(nmId, clusterName);
      const position = snap.status === "found" ? snap.organicPosition : null;
      const desired = computeDesiredBid({ position, currentBid, bidCap }, params);

      await this.repository.updateClusterBidObservation(advertId, nmId, ncn, {
        position,
        desiredBid: desired.bid,
        reason: desired.reason,
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
