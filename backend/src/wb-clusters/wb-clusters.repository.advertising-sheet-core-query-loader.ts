import type { Pool } from "pg";

import type {
  ClusterActionSyncStatus,
  ClusterBidSyncStatus,
  ClusterSourceKind,
} from "./wb-clusters.types";
import { WbClustersRepositoryAdvertisingMutationRead } from "./wb-clusters.repository.advertising-mutation-read";

export abstract class WbClustersRepositoryAdvertisingSheetCoreQueryLoader extends WbClustersRepositoryAdvertisingMutationRead {
  protected buildCanonicalClusterQueriesCte() {
    // Identity-based filter (punctuation-stripped): a member query is dropped if its
    // identity matches the identity of ANY cluster name for this nm_id — unless the
    // query represents its own cluster (self-representative). This catches WB's
    // punctuation variants (e.g. cluster "платье женское" + query "платье, женское")
    // that exact-text matching previously missed. Must stay in sync with the TS
    // deduplicatedQueryRows filter in advertising-sheet-builder.ts.
    return `
        WITH canonical_cluster_queries AS (
        SELECT cq.*
        FROM ${this.tableName("wb_cluster_queries")} cq
        LEFT JOIN LATERAL (
          SELECT normalized_cluster_name
          FROM ${this.tableName("wb_clusters")}
          WHERE nm_id = cq.nm_id
          AND ${this.normalizedQueryIdentitySql("normalized_cluster_name")} = ${this.normalizedQueryIdentitySql("cq.normalized_query_text")}
          LIMIT 1
        ) identity_cluster ON TRUE
        WHERE cq.nm_id = $1
        AND (
        identity_cluster.normalized_cluster_name IS NULL
        OR ${this.normalizedQueryIdentitySql("cq.normalized_cluster_name")} = ${this.normalizedQueryIdentitySql("cq.normalized_query_text")}
        )
        )
        `;
  }

  protected async loadProductAdvertisingSheetCoreRows(pool: Pool, nmId: number) {
    const canonicalClusterQueriesCte = this.buildCanonicalClusterQueriesCte();
    const [campaignsResult, clustersResult] = await Promise.all([
      pool.query<{
          advert_id: string;
          campaign_type: number;
          campaign_status: number;
          payment_type: string | null;
          bid_type: string | null;
          placements_search: boolean | null;
          placements_recommendations: boolean | null;
          currency: string | null;
          name: string | null;
          subject_id: number | null;
          subject_name: string | null;
          change_time: string | null;
          created_at_wb: string | null;
          started_at_wb: string | null;
          updated_at_wb: string | null;
          synced_at: string | null;
          }>(
          `
          SELECT
          c.advert_id::text AS advert_id,
          c.campaign_type,
          c.campaign_status,
          c.payment_type,
          c.bid_type,
          c.placements_search,
          c.placements_recommendations,
          c.currency,
          c.name,
          cp.subject_id,
          cp.subject_name,
          c.change_time::text AS change_time,
          c.created_at_wb::text AS created_at_wb,
          c.started_at_wb::text AS started_at_wb,
          c.updated_at_wb::text AS updated_at_wb,
          GREATEST(c.synced_at, cp.synced_at)::text AS synced_at
          FROM ${this.tableName("wb_campaign_products")} cp
          JOIN ${this.tableName("wb_campaigns")} c
          ON c.advert_id = cp.advert_id
          WHERE cp.nm_id = $1
          ORDER BY c.advert_id
          `,
          [nmId],
          )
      ,
      pool.query<{
          advert_id: string | null;
          campaign_name: string | null;
          campaign_type: number | null;
          campaign_status: number | null;
          payment_type: string | null;
          bid_type: string | null;
          currency: string | null;
          cluster_name: string;
          normalized_cluster_name: string;
          canonical_norm_query: string;
          source_kind: ClusterSourceKind;
          is_active: boolean | null;
          views: string | null;
          clicks: string | null;
          orders: string | null;
          add_to_cart: string | null;
          shks: string | null;
          ctr: string | null;
          avg_position: string | null;
          cpc: string | null;
          cpm: string | null;
          spend: string | null;
          bid: string | null;
          bid_sync_status: ClusterBidSyncStatus | null;
          bid_confirmed_at: string | null;
          bid_retry_at: string | null;
          bid_last_error: string | null;
          action_sync_status: ClusterActionSyncStatus | null;
          action_retry_at: string | null;
          action_last_error: string | null;
          monthly_frequency: string | null;
          updated_at: string | null;
          }>(
          `
          ${canonicalClusterQueriesCte}
          SELECT
          c.advert_id::text AS advert_id,
          campaign.name AS campaign_name,
          campaign.campaign_type,
          campaign.campaign_status,
          campaign.payment_type,
          campaign.bid_type,
          campaign.currency,
          c.cluster_name,
          c.normalized_cluster_name,
          COALESCE(b.cluster_name, c.cluster_name) AS canonical_norm_query,
          CASE
          WHEN a.action_key IS NOT NULL THEN
          CASE
          WHEN a.desired_is_active THEN 'active'
          ELSE 'excluded'
          END::text
          ELSE c.source_kind
          END AS source_kind,
          COALESCE(a.desired_is_active, c.is_active) AS is_active,
          s.views::text AS views,
          s.clicks::text AS clicks,
          s.orders::text AS orders,
          s.add_to_cart::text AS add_to_cart,
          s.shks::text AS shks,
          s.ctr::text AS ctr,
          s.avg_position::text AS avg_position,
          s.cpc::text AS cpc,
          s.cpm::text AS cpm,
          s.spend::text AS spend,
          COALESCE(b.bid, cp.search_bid, cp.min_search_bid)::text AS bid,
          CASE
          WHEN b.bid_key IS NOT NULL THEN COALESCE(b.bid_sync_status, 'confirmed')
          WHEN cp.search_bid IS NOT NULL THEN 'confirmed'
          WHEN cp.min_search_bid IS NOT NULL THEN 'confirmed'
          ELSE NULL
          END AS bid_sync_status,
          CASE
          WHEN b.bid_key IS NOT NULL
          AND COALESCE(b.bid_sync_status, 'confirmed') = 'confirmed'
          THEN COALESCE(b.bid_confirmed_at, b.synced_at)::text
          WHEN b.bid_key IS NOT NULL THEN NULL
          WHEN cp.search_bid IS NOT NULL THEN COALESCE(cp.search_bid_synced_at, cp.synced_at)::text
          WHEN cp.min_search_bid IS NOT NULL THEN COALESCE(cp.min_search_bid_synced_at, cp.synced_at)::text
          ELSE NULL
          END AS bid_confirmed_at,
          b.bid_retry_at::text AS bid_retry_at,
          b.bid_last_error,
          a.action_sync_status,
          a.action_retry_at::text AS action_retry_at,
          a.action_last_error,
          f.monthly_frequency::text AS monthly_frequency,
          GREATEST(
          c.synced_at,
          COALESCE(s.synced_at, c.synced_at),
          COALESCE(b.synced_at, c.synced_at),
          COALESCE(a.synced_at, c.synced_at),
          COALESCE(f.synced_at, c.synced_at)
          )::text AS updated_at
          FROM ${this.tableName("wb_clusters")} c
          LEFT JOIN ${this.tableName("wb_campaigns")} campaign
          ON campaign.advert_id = c.advert_id
          LEFT JOIN ${this.tableName("wb_cluster_stats")} s
          ON s.cluster_key = c.cluster_key
          LEFT JOIN ${this.tableName("wb_cluster_bids")} b
          ON b.advert_id = c.advert_id
          AND b.nm_id = c.nm_id
          AND b.normalized_cluster_name = c.normalized_cluster_name
          LEFT JOIN ${this.tableName("wb_cluster_actions")} a
          ON a.advert_id = c.advert_id
          AND a.nm_id = c.nm_id
          AND a.normalized_cluster_name = c.normalized_cluster_name
          LEFT JOIN ${this.tableName("wb_campaign_products")} cp
          ON cp.advert_id = c.advert_id
          AND cp.nm_id = c.nm_id
          LEFT JOIN (
          -- Aggregate cluster frequency by joining on normalized_query_identity
          -- (punctuation-stripped). Three benefits over the prior text-exact join:
          --   1) punctuation variants of a member query collapse to one lookup row,
          --      so they cannot be double-counted within a cluster;
          --   2) wb_search_query_frequencies is import-deduped by identity, so the
          --      single surviving row is reliably found regardless of which punctuation
          --      variant won the dedup;
          --   3) cluster names with punctuation reliably resolve to their own freq.
          -- Uses existing index wb_search_query_frequencies(normalized_query_identity).
          SELECT
          x.advert_id,
          x.nm_id,
          x.normalized_cluster_name,
          SUM(f.monthly_frequency) AS monthly_frequency,
          MAX(f.synced_at) AS synced_at
          FROM (
          SELECT DISTINCT
          advert_id,
          nm_id,
          normalized_cluster_name,
          ${this.normalizedQueryIdentitySql("normalized_query_text")} AS lookup_identity
          FROM canonical_cluster_queries
          UNION
          SELECT DISTINCT
          c.advert_id,
          c.nm_id,
          c.normalized_cluster_name,
          ${this.normalizedQueryIdentitySql("c.normalized_cluster_name")} AS lookup_identity
          FROM ${this.tableName("wb_clusters")} c
          WHERE c.nm_id = $1
          ) x
          JOIN ${this.tableName("wb_search_query_frequencies")} f
          ON f.normalized_query_identity = x.lookup_identity
          GROUP BY x.advert_id, x.nm_id, x.normalized_cluster_name
          ) f
          ON f.advert_id = c.advert_id
          AND f.nm_id = c.nm_id
          AND f.normalized_cluster_name = c.normalized_cluster_name
          WHERE c.nm_id = $1
          ORDER BY
          COALESCE(c.advert_id, 0),
          CASE c.source_kind
          WHEN 'stats' THEN 0
          WHEN 'excluded' THEN 1
          WHEN 'active' THEN 2
          ELSE 3
          END,
          c.cluster_name
          `,
          [nmId],
          )
      ,
    ]);
    return {
      campaignsResult,
      clustersResult,
    };
  }

}
