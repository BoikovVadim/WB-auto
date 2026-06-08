import { WbClustersRepositoryClusterCpoInputs } from "./wb-clusters.repository.cluster-cpo-inputs";
import { type ClusterReviewStatus } from "./wb-clusters.repository.automation";

/** Сырые тексты для мусор-фильтра релевантности кластера (токенизацию делает сервис). */
export interface ClusterRelevanceData {
  /** Профиль товара: название + бренд + предмет, склеенные через пробел. */
  productProfileText: string;
  /** Все кластеры товара с их фразами и статусом модерации. */
  clusters: {
    normalizedClusterName: string;
    reviewStatus: ClusterReviewStatus;
    phrasesText: string;
  }[];
}

/**
 * Звено репозитория для мусор-фильтра релевантности кластеров. Отдаёт сырые тексты
 * (профиль товара + фразы кластеров + статус модерации); токенизацию и само решение
 * делает ProductClusterRelevanceService. См. product-cluster-relevance.ts.
 */
export abstract class WbClustersRepositoryClusterRelevance extends WbClustersRepositoryClusterCpoInputs {
  async getClusterRelevanceData(advertId: number, nmId: number): Promise<ClusterRelevanceData> {
    await this.ensureSchemaOrThrow();
    const profileResult = await this.getPool().query<{
      product_name: string | null;
      brand_name: string | null;
      subject_name: string | null;
    }>(
      `SELECT product_name, brand_name, subject_name
       FROM ${this.tableName("wb_product_catalog")}
       WHERE nm_id = $1`,
      [nmId],
    );
    const profile = profileResult.rows[0];
    const productProfileText = [profile?.product_name, profile?.brand_name, profile?.subject_name]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join(" ");

    const clustersResult = await this.getPool().query<{
      normalized_cluster_name: string;
      review_status: ClusterReviewStatus | null;
      phrases_text: string | null;
    }>(
      `SELECT cq.normalized_cluster_name,
              st.review_status                                   AS review_status,
              string_agg(DISTINCT cq.normalized_query_text, ' ') AS phrases_text
       FROM ${this.tableName("wb_cabinet_cluster_queries")} cq
       LEFT JOIN ${this.tableName("wb_cluster_automation_state")} st
         ON st.advert_id = cq.advert_id AND st.nm_id = cq.nm_id
        AND st.normalized_cluster_name = cq.normalized_cluster_name
       WHERE cq.advert_id = $1 AND cq.nm_id = $2
       GROUP BY cq.normalized_cluster_name, st.review_status`,
      [advertId, nmId],
    );
    return {
      productProfileText,
      clusters: clustersResult.rows.map((r) => ({
        normalizedClusterName: r.normalized_cluster_name,
        reviewStatus: r.review_status ?? "approved",
        phrasesText: r.phrases_text ?? "",
      })),
    };
  }

  /**
   * Обучение мусор-фильтра: прибавляет счётчики словам из решения менеджера по товару.
   * polarity 'positive' (approve/protect) → pos_count++, 'negative' (reject) → neg_count++.
   */
  async learnRelevanceTerms(
    nmId: number,
    tokens: string[],
    polarity: "positive" | "negative",
  ): Promise<void> {
    const unique = [...new Set(tokens)].filter((t) => t.length > 0);
    if (unique.length === 0) return;
    await this.ensureSchemaOrThrow();
    const pos = polarity === "positive" ? 1 : 0;
    const neg = polarity === "negative" ? 1 : 0;
    const placeholders = unique.map((_, i) => `($1, $${i + 4}, $2, $3)`).join(", ");
    await this.getPool().query(
      `INSERT INTO ${this.tableName("wb_cluster_relevance_term")} (nm_id, token, pos_count, neg_count)
       VALUES ${placeholders}
       ON CONFLICT (nm_id, token) DO UPDATE SET
         pos_count = ${this.tableName("wb_cluster_relevance_term")}.pos_count + EXCLUDED.pos_count,
         neg_count = ${this.tableName("wb_cluster_relevance_term")}.neg_count + EXCLUDED.neg_count,
         updated_at = NOW()`,
      [nmId, pos, neg, ...unique],
    );
  }

  /** Выученные слова товара: token → {pos, neg}. Для мусор-фильтра (negative-перевес). */
  async getRelevanceTerms(nmId: number): Promise<Map<string, { pos: number; neg: number }>> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      token: string;
      pos_count: number;
      neg_count: number;
    }>(
      `SELECT token, pos_count, neg_count
       FROM ${this.tableName("wb_cluster_relevance_term")}
       WHERE nm_id = $1`,
      [nmId],
    );
    return new Map(result.rows.map((r) => [r.token, { pos: r.pos_count, neg: r.neg_count }]));
  }
}
