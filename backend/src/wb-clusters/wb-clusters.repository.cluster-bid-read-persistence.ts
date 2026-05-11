import { WbClustersRepositoryClusterBidWritePersistence } from "./wb-clusters.repository.cluster-bid-write-persistence";

export abstract class WbClustersRepositoryClusterBidReadPersistence extends WbClustersRepositoryClusterBidWritePersistence {
  async listPendingClusterBids(limit = 50) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{
      advert_id: string;
      nm_id: string;
      cluster_name: string;
      bid: string | null;
      synced_at: string;
    }>(
      `
        SELECT
          advert_id::text AS advert_id,
          nm_id::text AS nm_id,
          cluster_name,
          bid::text AS bid,
          synced_at::text AS synced_at
        FROM ${this.tableName("wb_cluster_bids")}
        WHERE bid_sync_status = 'pending'
          AND bid IS NOT NULL
        ORDER BY synced_at ASC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows
      .map((row) => ({
        advertId: Number(row.advert_id),
        nmId: Number(row.nm_id),
        clusterName: row.cluster_name,
        bid: this.toNullableNumber(row.bid),
        syncedAt: row.synced_at,
      }))
      .filter(
        (row) =>
          Number.isFinite(row.advertId) &&
          Number.isFinite(row.nmId) &&
          typeof row.bid === "number",
      ) as Array<{
      advertId: number;
      nmId: number;
      clusterName: string;
      bid: number;
      syncedAt: string;
    }>;
  }

}
