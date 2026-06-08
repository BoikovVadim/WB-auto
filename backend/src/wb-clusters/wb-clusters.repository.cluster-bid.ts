import { WbClustersRepositoryAccrual } from "./wb-clusters.repository.accrual";

/**
 * Звено репозитория ставочного движка (этап 3): наблюдение за ставкой кластера —
 * последняя позиция (с рекламой), желаемая ставка и причина решения. Применение ставки к WB
 * идёт через существующую очередь (applyProductClusterBids); здесь только запись наблюдения
 * в wb_cluster_automation_state. См. product-cluster-bid.ts и bid-engine сервис.
 */
export abstract class WbClustersRepositoryClusterBid extends WbClustersRepositoryAccrual {
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
