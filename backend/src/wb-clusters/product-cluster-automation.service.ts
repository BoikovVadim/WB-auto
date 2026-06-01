import { Injectable, Logger } from "@nestjs/common";

import { ProductCpoService } from "./product-cpo.service";
import type {
  AutomationMode,
  ClusterAutomationStateValue,
  ClusterCpoInput,
} from "./wb-clusters.repository.automation";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbClustersService } from "./wb-clusters.service";

/** Доля кластеров, выше которой массовое авто-исключение блокируется (защита от обнуления РК). */
const MAX_EXCLUDE_SHARE = 0.8;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

interface ClusterDecision {
  normalizedClusterName: string;
  clusterName: string;
  effectiveCpo: number | null;
  state: ClusterAutomationStateValue;
  manualProtected: boolean;
  /** Действие относительно текущего состояния на WB. */
  decision: "include" | "exclude" | "noop";
}

/**
 * Автоматизация управления кластерами по CPO. Каждые 10 минут для кампаний с включённой
 * автоматизацией пересчитывает CPO каждого кластера и приводит состав к правилу
 * «CPO ≤ макс. CPO товара → включить, CPO > макс → исключить».
 *
 * CPO кластера = max(spend/orders_РК, spend/orders_JAM) за скользящие 30 дней (берём
 * больший — консервативно). Расход без заказов → CPO = ∞ → исключить. Нет расхода и
 * заказов → «выбыл» (исключён, сам не вернётся; сотрудник может включить вручную —
 * тогда иммунитет к выбыванию по «нет данных», пока не наберёт CPO > макс).
 *
 * Режимы: 'preview' — считаем и сохраняем решения, WB НЕ трогаем; 'live' — реально
 * включаем/исключаем через существующую очередь действий (applyProductClusterAction).
 */
@Injectable()
export class ProductClusterAutomationService {
  private readonly logger = new Logger("ProductClusterAutomation");

  constructor(
    private readonly repository: WbClustersRepository,
    private readonly wbClustersService: WbClustersService,
    private readonly productCpoService: ProductCpoService,
  ) {}

  async setMode(advertId: number, nmId: number, mode: AutomationMode): Promise<void> {
    await this.repository.setAutomationMode(advertId, nmId, mode);
    // Сразу один прогон, чтобы решения появились без ожидания крона (preview — без записи в WB).
    if (mode !== "off") {
      await this.evaluateOne(advertId, nmId, mode).catch((e: unknown) => {
        this.logger.warn(`Initial automation pass failed for ${advertId}/${nmId}: ${String(e)}`);
      });
    }
  }

  /** Статус автоматизации + per-cluster решения (для UI рекламного воркспейса). */
  async getStatus(advertId: number, nmId: number): Promise<{
    mode: AutomationMode;
    maxCpo: number | null;
    clusters: {
      normalizedClusterName: string;
      state: ClusterAutomationStateValue;
      manualProtected: boolean;
      lastCpo: number | null;
      lastDecision: string | null;
    }[];
  }> {
    const [mode, productCpo, states] = await Promise.all([
      this.repository.getAutomationMode(advertId, nmId),
      this.productCpoService.getProductCpo(nmId),
      this.repository.getClusterAutomationStates(advertId, nmId),
    ]);
    return { mode, maxCpo: productCpo.maxCpo, clusters: states };
  }

  /** Крон-обход: один прогон по всем включённым (preview/live) кампаниям. */
  async runAll(): Promise<void> {
    const enabled = await this.repository.listEnabledAutomations();
    for (const a of enabled) {
      await this.evaluateOne(a.advertId, a.nmId, a.mode).catch((e: unknown) => {
        this.logger.warn(`Automation pass failed for ${a.advertId}/${a.nmId}: ${String(e)}`);
      });
    }
  }

  /** Считает решения по всем кластерам кампании; в live — применяет к WB. */
  async evaluateOne(advertId: number, nmId: number, mode: AutomationMode): Promise<ClusterDecision[]> {
    if (mode === "off") return [];
    const maxCpo = (await this.productCpoService.getProductCpo(nmId)).maxCpo;
    if (maxCpo == null) return []; // нет порога (нет цены/выкупа/ДРР) — решать не на чем

    const [inputs, prevStates] = await Promise.all([
      this.repository.getClusterCpoInputs(advertId, nmId),
      this.repository.getClusterAutomationStates(advertId, nmId),
    ]);
    const prevByCluster = new Map(prevStates.map((s) => [s.normalizedClusterName, s]));

    const decisions = inputs.map((input) =>
      this.decideForCluster(input, maxCpo, prevByCluster.get(input.normalizedClusterName), mode),
    );

    // Применяем к WB только в live и только при отличии от текущего состояния.
    if (mode === "live") {
      await this.applyDecisions(advertId, nmId, decisions, inputs.length);
    }

    // Сохраняем состояние (и в preview — для отображения «что бы сделали»).
    for (const d of decisions) {
      await this.repository.upsertClusterAutomationState({
        advertId,
        nmId,
        normalizedClusterName: d.normalizedClusterName,
        state: d.state,
        manualProtected: d.manualProtected,
        lastCpo: d.effectiveCpo,
        lastDecision: d.decision,
      });
    }
    return decisions;
  }

  private decideForCluster(
    input: ClusterCpoInput,
    maxCpo: number,
    prev: { state: ClusterAutomationStateValue; manualProtected: boolean; lastDecision: string | null } | undefined,
    mode: AutomationMode,
  ): ClusterDecision {
    const isExcludedNow = input.currentSourceKind === "excluded";

    // Ручная защита: в live, если кластер сейчас активен, а автоматика в прошлый прогон
    // его исключала — значит сотрудник вернул вручную → иммунитет к выбыванию по «нет данных».
    let manualProtected = prev?.manualProtected ?? false;
    if (mode === "live" && !isExcludedNow && prev?.lastDecision === "exclude") {
      manualProtected = true;
    }

    // CPO = max(spend/orders_РК, spend/orders_JAM). Расход без заказов → ∞ (исключить).
    const cpoRk = input.ordersRk > 0 ? input.spend / input.ordersRk : input.spend > 0 ? Infinity : null;
    const cpoJam = input.ordersJam > 0 ? input.spend / input.ordersJam : input.spend > 0 ? Infinity : null;
    const candidates = [cpoRk, cpoJam].filter((c): c is number => c !== null);
    const effectiveCpo = candidates.length > 0 ? Math.max(...candidates) : null;

    let desiredActive: boolean;
    let state: ClusterAutomationStateValue;
    if (effectiveCpo !== null) {
      // Есть расход → решаем по CPO. ∞ (> max) → исключить.
      if (effectiveCpo <= maxCpo) {
        desiredActive = true;
        state = "active";
        manualProtected = false; // набрал хороший CPO — защита не нужна
      } else {
        desiredActive = false;
        state = "excluded_high";
        manualProtected = false; // авто-исключение по CPO сильнее ручной защиты
      }
    } else {
      // Нет сигнала (нет расхода и заказов) → выбыл, если не защищён вручную.
      if (manualProtected) {
        desiredActive = true;
        state = "manual_protected";
      } else {
        desiredActive = false;
        state = "dropped";
      }
    }

    let decision: ClusterDecision["decision"] = "noop";
    if (desiredActive && isExcludedNow) decision = "include";
    else if (!desiredActive && !isExcludedNow) decision = "exclude";

    return {
      normalizedClusterName: input.normalizedClusterName,
      clusterName: input.clusterName,
      effectiveCpo: effectiveCpo != null && Number.isFinite(effectiveCpo) ? round2(effectiveCpo) : null,
      state,
      manualProtected,
      decision,
    };
  }

  private async applyDecisions(
    advertId: number,
    nmId: number,
    decisions: ClusterDecision[],
    totalClusters: number,
  ): Promise<void> {
    const toExclude = decisions.filter((d) => d.decision === "exclude");
    const toInclude = decisions.filter((d) => d.decision === "include");

    // Гард: не исключать разом почти всё (защита от обнуления кампании).
    if (totalClusters > 0 && toExclude.length / totalClusters > MAX_EXCLUDE_SHARE) {
      this.logger.warn(
        `Automation ${advertId}/${nmId}: исключение ${toExclude.length}/${totalClusters} кластеров превышает порог ${MAX_EXCLUDE_SHARE * 100}% — пропускаю запись на WB.`,
      );
      return;
    }

    if (toExclude.length > 0) {
      await this.wbClustersService.applyProductClusterAction(
        nmId,
        advertId,
        "exclude",
        toExclude.map((d) => d.clusterName),
      );
    }
    if (toInclude.length > 0) {
      await this.wbClustersService.applyProductClusterAction(
        nmId,
        advertId,
        "include",
        toInclude.map((d) => d.clusterName),
      );
    }
  }
}
