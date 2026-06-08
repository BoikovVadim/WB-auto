import { computeBidCap, computeClusterCr } from "./product-cluster-bid";
import type { ClusterDecision } from "./product-cluster-decision";
import type { PendingRelevanceResult } from "./product-cluster-relevance.service";
import type {
  ClusterAutomationStateValue,
  ClusterCpoInput,
} from "./wb-clusters.repository.automation";

/**
 * Чистый маппер: превращает посчитанные decisions + входы CPO + advisory-рекомендации
 * мусор-фильтра в строки для upsertClusterAutomationStates. Вынесено из
 * product-cluster-automation.service по ответственности (orchestration ≠ row-mapping).
 *
 * CR (показ→заказ) и потолок ставки CPM (bidCap) считаются от РЕАЛЬНЫХ показов за 30 дней
 * (cpoInputs.views), а не от крошечного накопителя корзины — это наблюдение для движка ставок.
 */
export function buildAutomationStateRows(params: {
  advertId: number;
  nmId: number;
  decisions: ClusterDecision[];
  inputs: ClusterCpoInput[];
  suggestions: Map<string, PendingRelevanceResult>;
  maxCpo: number;
}) {
  const { advertId, nmId, decisions, inputs, suggestions, maxCpo } = params;
  const inputByNcn = new Map(inputs.map((i) => [i.normalizedClusterName, i]));

  return decisions.map((d) => {
    const inp = inputByNcn.get(d.normalizedClusterName);
    const cr = inp
      ? computeClusterCr({
          accruedOrdersRk: inp.shks ?? inp.ordersRk,
          accruedOrdersJam: inp.ordersJam,
          accruedViews: inp.views,
        })
      : null;
    const bidCap = cr !== null ? computeBidCap(maxCpo, cr) : null;
    return {
      advertId,
      nmId,
      normalizedClusterName: d.normalizedClusterName,
      state: d.state,
      manualProtected: d.manualProtected,
      lastCpo: d.effectiveCpo,
      lastSpend: d.spend,
      lastDecision: d.decision,
      reviewStatus: d.reviewStatus,
      suggestedReviewAction:
        d.reviewStatus === "pending"
          ? suggestions.get(d.normalizedClusterName)?.suggestion ?? null
          : null,
      lastCr: cr,
      lastBidCap: bidCap,
    };
  });
}

/**
 * Применяет решения к WB через переданный callback. Возвращает `{ blocked }`: true, если гард
 * `maxExcludeShare` остановил запись целиком (защита от обнуления РК массовым исключением) —
 * тогда вызывающий НЕ фиксирует кластеры как excluded, чтобы БД не разошлась с кабинетом.
 */
export async function applyDecisionsToWb(params: {
  advertId: number;
  nmId: number;
  decisions: ClusterDecision[];
  totalClusters: number;
  maxExcludeShare: number;
  applyAction: (action: "include" | "exclude", clusterNames: string[]) => Promise<unknown>;
  onBlocked: (message: string) => void;
}): Promise<{ blocked: boolean }> {
  const { advertId, nmId, decisions, totalClusters, maxExcludeShare, applyAction, onBlocked } =
    params;
  const toExclude = decisions.filter((d) => d.decision === "exclude");
  const toInclude = decisions.filter((d) => d.decision === "include");

  if (totalClusters > 0 && toExclude.length / totalClusters > maxExcludeShare) {
    onBlocked(
      `Automation ${advertId}/${nmId}: исключение ${toExclude.length}/${totalClusters} кластеров превышает порог ${maxExcludeShare * 100}% — пропускаю запись на WB.`,
    );
    return { blocked: true };
  }

  if (toExclude.length > 0) await applyAction("exclude", toExclude.map((d) => d.clusterName));
  if (toInclude.length > 0) await applyAction("include", toInclude.map((d) => d.clusterName));
  return { blocked: false };
}

/**
 * Откатывает state/decision заблокированных гардом решений к прежним значениям (с WB ничего не
 * применилось). Метрики CPO/расхода в самих decisions не трогаем — кластер честно остаётся
 * виден как «дорогой, но исключить не дали». noop-решения возвращаются как есть.
 */
export function revertBlockedDecisions(
  decisions: ClusterDecision[],
  prevByCluster: Map<string, { state: ClusterAutomationStateValue; manualProtected: boolean }>,
): ClusterDecision[] {
  return decisions.map((d) => {
    if (d.decision === "noop") return d;
    const prev = prevByCluster.get(d.normalizedClusterName);
    return {
      ...d,
      decision: "noop" as const,
      state: prev?.state ?? "active",
      manualProtected: prev?.manualProtected ?? d.manualProtected,
    };
  });
}
