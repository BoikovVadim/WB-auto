import type { ClusterBidSyncStatus } from "./wb-clusters.types";
import { WbClustersRepositoryClusterCorePersistence } from "./wb-clusters.repository.cluster-core-persistence";

export abstract class WbClustersRepositoryClusterBidReplacePersistence extends WbClustersRepositoryClusterCorePersistence {
  async replaceClusterBids(
    items: Array<{ advertId: number; nmId: number }>,
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
    options?: { preservePending?: boolean },
  ) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const pendingBidsByItem = new Map<
        string,
        Array<{
          cluster_name: string;
          normalized_cluster_name: string;
          bid: string | null;
          bid_sync_status: ClusterBidSyncStatus | null;
          bid_confirmed_at: string | null;
          bid_retry_at: string | null;
          bid_last_error: string | null;
        }>
      >();

      if (options?.preservePending) {
        for (const item of items) {
          const pendingRows = await client.query<{
            cluster_name: string;
            normalized_cluster_name: string;
            bid: string | null;
            bid_sync_status: ClusterBidSyncStatus | null;
            bid_confirmed_at: string | null;
            bid_retry_at: string | null;
            bid_last_error: string | null;
          }>(
            `
              SELECT
                cluster_name,
                normalized_cluster_name,
                bid::text AS bid,
                bid_sync_status,
                bid_confirmed_at::text AS bid_confirmed_at,
                bid_retry_at::text AS bid_retry_at,
                bid_last_error
              FROM ${this.tableName("wb_cluster_bids")}
              WHERE advert_id = $1
                AND nm_id = $2
                AND bid IS NOT NULL
            `,
            [item.advertId, item.nmId],
          );
          pendingBidsByItem.set(`${item.advertId}:${item.nmId}`, pendingRows.rows);
        }
      }

      for (const item of items) {
        await client.query(
          `DELETE FROM ${this.tableName("wb_cluster_bids")} WHERE advert_id = $1 AND nm_id = $2`,
          [item.advertId, item.nmId],
        );
      }

      const knownClustersByItem = new Map<
        string,
        Array<{ cluster_name: string; normalized_cluster_name: string }>
      >();
      for (const item of items) {
        const clustersResult = await client.query<{
          cluster_name: string;
          normalized_cluster_name: string;
        }>(
          `
            SELECT DISTINCT
              cluster_name,
              normalized_cluster_name
            FROM ${this.tableName("wb_clusters")}
            WHERE advert_id = $1 AND nm_id = $2
          `,
          [item.advertId, item.nmId],
        );
        knownClustersByItem.set(
          `${item.advertId}:${item.nmId}`,
          clustersResult.rows,
        );
      }

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
            bid.bid_sync_status ?? "confirmed",
            bid.bid_confirmed_at ?? new Date().toISOString(),
            bid.bid_retry_at ?? null,
            bid.bid_last_error ?? null,
          ],
        );
      }

      for (const item of items) {
        const scopedKey = `${item.advertId}:${item.nmId}`;
        const providedClusters = new Set(
          bids
            .filter((bid) => bid.advert_id === item.advertId && bid.nm_id === item.nmId)
            .map((bid) => this.normalizeQuery(bid.norm_query)),
        );
        const knownClusters = knownClustersByItem.get(scopedKey) ?? [];

        for (const cluster of knownClusters) {
          if (providedClusters.has(cluster.normalized_cluster_name)) {
            continue;
          }

          const bidKey = this.buildScopedTextKey(
            item.advertId,
            item.nmId,
            cluster.cluster_name,
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
              item.advertId,
              item.nmId,
              cluster.cluster_name,
              cluster.normalized_cluster_name,
              null,
              "confirmed",
              new Date().toISOString(),
              null,
              null,
            ],
          );
        }

        const pendingBids = pendingBidsByItem.get(scopedKey) ?? [];
        for (const pendingBid of pendingBids) {
          const bidKey = this.buildScopedTextKey(
            item.advertId,
            item.nmId,
            pendingBid.cluster_name,
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
              item.advertId,
              item.nmId,
              pendingBid.cluster_name,
              pendingBid.normalized_cluster_name,
              this.toNullableNumber(pendingBid.bid),
              pendingBid.bid_sync_status ?? "pending",
              pendingBid.bid_confirmed_at,
              pendingBid.bid_retry_at,
              pendingBid.bid_last_error,
            ],
          );
        }
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
