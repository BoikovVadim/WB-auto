import type {
  ClusterBidSyncStatus,
} from "./wb-clusters.types";
import { WbClustersRepositoryClusterBidReplacePersistence } from "./wb-clusters.repository.cluster-bid-replace-persistence";

export abstract class WbClustersRepositoryClusterBidUpsertPersistence extends WbClustersRepositoryClusterBidReplacePersistence {
  async upsertClusterBids(
    bids: Array<{
      advert_id: number;
      nm_id: number;
      norm_query: string;
      bid?: number;
      bid_sync_status?: ClusterBidSyncStatus | null;
      bid_confirmed_at?: string | null;
      bid_retry_at?: string | null;
      bid_last_error?: string | null;
    }>,
  ) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await this.upsertClusters(
        bids.map((bid) => ({
          advertId: bid.advert_id,
          nmId: bid.nm_id,
          clusterName: bid.norm_query,
          sourceKind: "active",
          isActive: true,
        })),
        client,
      );

      for (const bid of bids) {
        const bidKey = this.buildScopedTextKey(
          bid.advert_id,
          bid.nm_id,
          bid.norm_query,
        );
        await client.query(
          `
            INSERT INTO ${this.tableName("wb_cluster_bids")} (
              bid_key,
              advert_id,
              nm_id,
              cluster_name,
              normalized_cluster_name,
              bid,
              bid_sync_status,
              bid_confirmed_at,
              bid_retry_at,
              bid_last_error,
              synced_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
            ON CONFLICT (bid_key) DO UPDATE
            SET
              cluster_name = EXCLUDED.cluster_name,
              normalized_cluster_name = EXCLUDED.normalized_cluster_name,
              bid = EXCLUDED.bid,
              bid_sync_status = EXCLUDED.bid_sync_status,
              bid_confirmed_at = EXCLUDED.bid_confirmed_at,
              bid_retry_at = EXCLUDED.bid_retry_at,
              bid_last_error = EXCLUDED.bid_last_error,
              synced_at = NOW()
          `,
          [
            bidKey,
            bid.advert_id,
            bid.nm_id,
            bid.norm_query,
            this.normalizeQuery(bid.norm_query),
            typeof bid.bid === "number" && Number.isFinite(bid.bid) ? bid.bid : null,
            bid.bid_sync_status ?? "pending",
            bid.bid_confirmed_at ?? null,
            bid.bid_retry_at ?? null,
            bid.bid_last_error ?? null,
          ],
        );
      }

      await client.query("COMMIT");
      return bids.length;
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

}
