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

/** Результат мусор-фильтра по pending-кластеру. */
export interface PendingRelevanceResult {
  /** Рекомендация-подпись для модалки модерации. */
  suggestion: SuggestedReviewAction;
  /** Авто-в-чёрный без модерации: у кластера есть слово, выученное менеджером как чёрное. */
  autoBlacklist: boolean;
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

  /** Обучение от решения менеджера: слова названия кластера → pos (approve/protect) / neg (reject). */
  async learnFromReview(
    nmId: number,
    clusterName: string,
    action: "approve" | "reject" | "protect",
  ): Promise<void> {
    const tokens = this.repository.tokenizeAdvertisingStems(clusterName);
    if (tokens.length === 0) return;
    await this.repository.learnRelevanceTerms(
      nmId,
      tokens,
      action === "reject" ? "negative" : "positive",
    );
  }

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
  ): Promise<Map<string, PendingRelevanceResult>> {
    const result = new Map<string, PendingRelevanceResult>();
    if (pendingClusterNames.size === 0) return result;
    const [data, learned] = await Promise.all([
      this.repository.getClusterRelevanceData(advertId, nmId),
      this.repository.getRelevanceTerms(nmId),
    ]);

    // Выученные менеджером слова: negative-перевес → «чёрные», positive-перевес → релевантные.
    const learnedNegative = new Set<string>();
    const learnedPositive = new Set<string>();
    for (const [token, c] of learned) {
      if (c.neg > c.pos) learnedNegative.add(token);
      else if (c.pos > c.neg) learnedPositive.add(token);
    }

    // Релевантный эталон: токены профиля товара + фразы существующих (не-pending) кластеров +
    // выученные positive — всё, что уже признано относящимся к товару.
    const relevantTokens = new Set<string>([
      ...this.repository.tokenizeAdvertisingStems(data.productProfileText),
      ...learnedPositive,
    ]);
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
      // Выученный негатив: слово бракнуто менеджером И не входит в базовый релевантный набор
      // (защищает частые релевантные слова от случайного reject — «собак» останется релевантным).
      const hasLearnedNegative = clusterTokens.some(
        (t) => learnedNegative.has(t) && !relevantTokens.has(t),
      );
      const matchedTokens = clusterTokens.filter((t) => relevantTokens.has(t)).length;
      const orders = ordersByCluster.get(name);
      const hasOrders = orders != null && (orders.ordersRk > 0 || orders.ordersJam > 0);
      const suggestion = suggestReviewAction({
        learnedNegative: hasLearnedNegative,
        hasOrders,
        matchedTokens,
        clusterTokens: clusterTokens.length,
      });
      result.set(name, { suggestion, autoBlacklist: hasLearnedNegative });
    }
    return result;
  }
}
