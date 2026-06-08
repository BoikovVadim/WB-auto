import { WbClustersRepositoryAccrual } from "./wb-clusters.repository.accrual";

/**
 * Звено репозитория ставочного движка (этап 3): наблюдение за ставкой кластера —
 * последняя позиция (с рекламой), желаемая ставка и причина решения. Применение ставки к WB
 * идёт через существующую очередь (applyProductClusterBids); здесь только запись наблюдения
 * в wb_cluster_automation_state. См. product-cluster-bid.ts и bid-engine сервис.
 */
export abstract class WbClustersRepositoryClusterBid extends WbClustersRepositoryAccrual {
  /**
   * Ставочные границы кампании-товара из WB (₽): searchBid — текущая базовая ставка кампании
   * (действует у кластеров без своей ставки), minSearchBid — минимально допустимая ставка WB
   * (из /api/advert/v1/bids/min). Источник правды для нижней границы и шага движка.
   */
  async getCampaignBidBounds(
    advertId: number,
    nmId: number,
  ): Promise<{ searchBid: number | null; minSearchBid: number | null }> {
    await this.ensureSchemaOrThrow();
    const r = await this.getPool().query<{ search_bid: string | null; min_search_bid: string | null }>(
      `SELECT search_bid::text, min_search_bid::text
       FROM ${this.tableName("wb_campaign_products")}
       WHERE advert_id = $1 AND nm_id = $2`,
      [advertId, nmId],
    );
    const row = r.rows[0];
    return {
      searchBid: row?.search_bid != null ? Number(row.search_bid) : null,
      minSearchBid: row?.min_search_bid != null ? Number(row.min_search_bid) : null,
    };
  }

  /** Записать наблюдение bid-движка по одному кластеру (позиция/желаемая ставка/причина). */
  async updateClusterBidObservation(
    advertId: number,
    nmId: number,
    normalizedClusterName: string,
    obs: { position: number | null; desiredBid: number | null; reason: string },
  ): Promise<void> {
    await this.ensureSchemaOrThrow();
    await this.getPool().query(
      `UPDATE ${this.tableName("wb_cluster_automation_state")}
         SET last_position = $4, last_desired_bid = $5, last_bid_reason = $6
       WHERE advert_id = $1 AND nm_id = $2 AND normalized_cluster_name = $3`,
      [advertId, nmId, normalizedClusterName, obs.position, obs.desiredBid, obs.reason],
    );
  }
}
