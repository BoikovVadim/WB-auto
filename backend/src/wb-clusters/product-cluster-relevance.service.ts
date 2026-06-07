import { Injectable } from "@nestjs/common";

import {
  suggestReviewAction,
  type SuggestedReviewAction,
} from "./product-cluster-relevance";
import { WbClustersRepository } from "./wb-clusters.repository";

/** Заказы по кластеру за окно — сигнал «товар уже продаётся по этому запросу». */
export interface ClusterOrdersSignal {
  ordersRk: number;
  ordersJam: number;
}

/**
 * Мусор-фильтр релевантности: для pending-кластеров считает ADVISORY-рекомендацию
 * 'approve' | 'blacklist'. Решение принимает человек — движок только подписывает.
 *
 * Релевантный набор токенов = профиль товара (название/бренд/предмет) + фразы уже
 * ОДОБРЕННЫХ кластеров (что человек уже признал релевантным). Pending-кластер сверяется
 * с ним; плюс учитывается, идут ли по кластеру заказы. См. product-cluster-relevance.ts.
 */
@Injectable()
export class ProductClusterRelevanceService {
  constructor(private readonly repository: WbClustersRepository) {}

  /**
   * @param pendingClusterNames нормализованные имена кластеров, которые СЕЙЧАС на модерации
   *   (берётся из decisions движка, а не из БД: у только что появившегося кластера строки
   *   state ещё нет, по БД он выглядел бы approved).
   */
  async computeForPending(
    advertId: number,
    nmId: number,
    pendingClusterNames: Set<string>,
    ordersByCluster: Map<string, ClusterOrdersSignal>,
  ): Promise<Map<string, SuggestedReviewAction>> {
    const result = new Map<string, SuggestedReviewAction>();
    if (pendingClusterNames.size === 0) return result;
    const data = await this.repository.getClusterRelevanceData(advertId, nmId);

    // Релевантный эталон: токены профиля товара + токены фраз ВСЕХ существующих (не-pending)
    // кластеров — то, что уже признано относящимся к товару.
    const relevantTokens = new Set<string>(
      this.repository.tokenizeAdvertisingStems(data.productProfileText),
    );
    const phrasesByCluster = new Map<string, string>();
    for (const cluster of data.clusters) {
      phrasesByCluster.set(cluster.normalizedClusterName, cluster.phrasesText);
      if (pendingClusterNames.has(cluster.normalizedClusterName)) continue;
      for (const token of this.repository.tokenizeAdvertisingStems(cluster.phrasesText)) {
        relevantTokens.add(token);
      }
    }

    for (const name of pendingClusterNames) {
      const clusterTokens = this.repository.tokenizeAdvertisingStems(phrasesByCluster.get(name) ?? "");
      const matchedTokens = clusterTokens.filter((t) => relevantTokens.has(t)).length;
      const orders = ordersByCluster.get(name);
      const hasOrders = orders != null && (orders.ordersRk > 0 || orders.ordersJam > 0);
      result.set(
        name,
        suggestReviewAction({ hasOrders, matchedTokens, clusterTokens: clusterTokens.length }),
      );
    }
    return result;
  }
}
