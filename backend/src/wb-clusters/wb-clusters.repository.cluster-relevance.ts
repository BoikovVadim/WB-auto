import {
  WbClustersRepositoryAutomation,
  type ClusterReviewStatus,
} from "./wb-clusters.repository.automation";

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
export abstract class WbClustersRepositoryClusterRelevance extends WbClustersRepositoryAutomation {
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
}
