import type {
  ClusterSourceKind,
  ProductClusterLookupMatch,
} from "./wb-clusters.types";
import { WbClustersRepositoryAdvertisingQueryHelpers } from "./wb-clusters.repository.advertising-query-helpers";

export abstract class WbClustersRepositoryClusterLookupRead extends WbClustersRepositoryAdvertisingQueryHelpers {
  async lookupProductClusters(nmId: number, queries: string[]) {
    if (!this.isConfigured() || queries.length === 0) {
      return [] satisfies ProductClusterLookupMatch[];
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const normalizedQueries = queries.map((query) => this.normalizeQuery(query));
    const exactClusterResult = await pool.query<{
      query_text: string;
      cluster_name: string;
      source_kind: ClusterSourceKind;
      is_active: boolean | null;
      advert_id: string | null;
      views: string | null;
      clicks: string | null;
      orders: string | null;
      add_to_cart: string | null;
      shks: string | null;
      updated_at: string | null;
    }>(
      `
        SELECT DISTINCT ON (q.query_text)
          q.query_text,
          c.cluster_name,
          c.source_kind,
          c.is_active,
          c.advert_id::text AS advert_id,
          s.views::text AS views,
          s.clicks::text AS clicks,
          s.orders::text AS orders,
          s.add_to_cart::text AS add_to_cart,
          s.shks::text AS shks,
          COALESCE(s.synced_at, c.synced_at)::text AS updated_at
        FROM UNNEST($2::text[]) AS q(query_text)
        JOIN ${this.tableName("wb_clusters")} c
          ON c.nm_id = $1
         AND c.normalized_cluster_name = q.query_text
        LEFT JOIN ${this.tableName("wb_cluster_stats")} s
          ON s.cluster_key = c.cluster_key
        ORDER BY q.query_text,
                 CASE c.source_kind
                   WHEN 'stats' THEN 0
                   WHEN 'active' THEN 1
                   ELSE 2
                 END,
                 COALESCE(s.synced_at, c.synced_at) DESC
      `,
      [nmId, normalizedQueries],
    );

    const promotionQueryMapResult = await pool.query<{
      query_text: string;
      cluster_name: string | null;
      normalized_cluster_name: string;
      advert_id: string;
      source_kind: ClusterSourceKind;
      is_active: boolean | null;
      views: string | null;
      clicks: string | null;
      orders: string | null;
      add_to_cart: string | null;
      shks: string | null;
      updated_at: string;
    }>(
      `
        SELECT DISTINCT ON (q.query_text)
          q.query_text,
          cq.cluster_name,
          cq.normalized_cluster_name,
          cq.advert_id::text AS advert_id,
          COALESCE(assigned_cluster.source_kind, 'query-map')::text AS source_kind,
          COALESCE(assigned_cluster.is_active, TRUE) AS is_active,
          stats.views::text AS views,
          stats.clicks::text AS clicks,
          stats.orders::text AS orders,
          stats.add_to_cart::text AS add_to_cart,
          stats.shks::text AS shks,
          GREATEST(
            cq.synced_at,
            COALESCE(stats.synced_at, cq.synced_at),
            COALESCE(assigned_cluster.synced_at, cq.synced_at),
            COALESCE(exact_cluster.synced_at, cq.synced_at)
          )::text AS updated_at
        FROM UNNEST($2::text[]) AS q(query_text)
        JOIN ${this.tableName("wb_cluster_queries")} cq
          ON cq.nm_id = $1
         AND cq.normalized_query_text = q.query_text
        LEFT JOIN ${this.tableName("wb_clusters")} assigned_cluster
          ON assigned_cluster.nm_id = cq.nm_id
         AND assigned_cluster.advert_id = cq.advert_id
         AND assigned_cluster.normalized_cluster_name = cq.normalized_cluster_name
        LEFT JOIN ${this.tableName("wb_clusters")} exact_cluster
          ON exact_cluster.nm_id = cq.nm_id
         AND exact_cluster.advert_id = cq.advert_id
         AND exact_cluster.normalized_cluster_name = cq.normalized_query_text
        LEFT JOIN ${this.tableName("wb_cluster_stats")} stats
          ON stats.cluster_key = exact_cluster.cluster_key
        ORDER BY q.query_text,
                 (CASE WHEN cq.normalized_cluster_name = q.query_text THEN 0 ELSE 1 END) ASC,
                 COALESCE(stats.synced_at, assigned_cluster.synced_at, exact_cluster.synced_at, cq.synced_at) DESC
      `,
      [nmId, normalizedQueries],
    );

    const cabinetQueryMapResult = await pool.query<{
      query_text: string;
      cluster_name: string | null;
      normalized_cluster_name: string;
      advert_id: string;
      source_kind: ClusterSourceKind;
      is_active: boolean | null;
      views: string | null;
      clicks: string | null;
      orders: string | null;
      add_to_cart: string | null;
      shks: string | null;
      updated_at: string;
      captured_at: string;
    }>(
      `
        SELECT DISTINCT ON (q.query_text)
          q.query_text,
          cq.cluster_name,
          cq.normalized_cluster_name,
          cq.advert_id::text AS advert_id,
          COALESCE(assigned_cluster.source_kind, 'query-map')::text AS source_kind,
          COALESCE(assigned_cluster.is_active, TRUE) AS is_active,
          stats.views::text AS views,
          stats.clicks::text AS clicks,
          stats.orders::text AS orders,
          stats.add_to_cart::text AS add_to_cart,
          stats.shks::text AS shks,
          GREATEST(
            cq.synced_at,
            COALESCE(stats.synced_at, cq.synced_at),
            COALESCE(assigned_cluster.synced_at, cq.synced_at),
            COALESCE(exact_cluster.synced_at, cq.synced_at)
          )::text AS updated_at,
          cq.captured_at::text AS captured_at
        FROM UNNEST($2::text[]) AS q(query_text)
        JOIN ${this.tableName("wb_cabinet_cluster_queries")} cq
          ON cq.nm_id = $1
         AND cq.normalized_query_text = q.query_text
        LEFT JOIN ${this.tableName("wb_clusters")} assigned_cluster
          ON assigned_cluster.nm_id = cq.nm_id
         AND assigned_cluster.advert_id = cq.advert_id
         AND assigned_cluster.normalized_cluster_name = cq.normalized_cluster_name
        LEFT JOIN ${this.tableName("wb_clusters")} exact_cluster
          ON exact_cluster.nm_id = cq.nm_id
         AND exact_cluster.advert_id = cq.advert_id
         AND exact_cluster.normalized_cluster_name = cq.normalized_query_text
        LEFT JOIN ${this.tableName("wb_cluster_stats")} stats
          ON stats.cluster_key = exact_cluster.cluster_key
        ORDER BY q.query_text,
                 -- Prefer the row where the cluster IS the query itself (most canonical match).
                 -- e.g. query "клетка для кролика" → cluster "клетка для кролика" wins over
                 -- the same query mapped to an unrelated cluster in the same ad campaign.
                 (CASE WHEN cq.normalized_cluster_name = q.query_text THEN 0 ELSE 1 END) ASC,
                 cq.captured_at DESC,
                 cq.synced_at DESC
      `,
      [nmId, normalizedQueries],
    );

    const authoritativeQueryRows = await this.mergeAuthoritativeAdvertisingQueryRows(
      [
        ...promotionQueryMapResult.rows.map((row) => ({
          advertId: Number(row.advert_id),
          clusterName: row.cluster_name ?? row.normalized_cluster_name,
          normalizedClusterName: row.normalized_cluster_name,
          queryText: row.query_text,
          normalizedQueryText: row.query_text,
          mappingSource: "promotion" as const,
          isCabinetBacked: false,
          cabinetSnapshotAt: null,
          sourceKind: row.source_kind,
          isActive: row.is_active,
          views: this.toNullableNumber(row.views),
          clicks: this.toNullableNumber(row.clicks),
          orders: this.toNullableNumber(row.orders),
          addToCart: this.toNullableNumber(row.add_to_cart),
          shks: this.toNullableNumber(row.shks),
          monthlyFrequency: null,
          updatedAt: row.updated_at,
        })),
        ...cabinetQueryMapResult.rows.map((row) => ({
          advertId: Number(row.advert_id),
          clusterName: row.cluster_name ?? row.normalized_cluster_name,
          normalizedClusterName: row.normalized_cluster_name,
          queryText: row.query_text,
          normalizedQueryText: row.query_text,
          mappingSource: "cabinet" as const,
          isCabinetBacked: true,
          cabinetSnapshotAt: row.captured_at,
          sourceKind: row.source_kind,
          isActive: row.is_active,
          views: this.toNullableNumber(row.views),
          clicks: this.toNullableNumber(row.clicks),
          orders: this.toNullableNumber(row.orders),
          addToCart: this.toNullableNumber(row.add_to_cart),
          shks: this.toNullableNumber(row.shks),
          monthlyFrequency: null,
          updatedAt: row.updated_at,
        })),
      ],
    );

    const byQuery = new Map<string, ProductClusterLookupMatch>();
    for (const row of authoritativeQueryRows) {
      const normalizedIdentity = this.normalizeAdvertisingIdentity(row.queryText);
      if (byQuery.has(normalizedIdentity)) {
        continue;
      }
      byQuery.set(normalizedIdentity, {
        queryText: row.queryText,
        clusterName: row.clusterName,
        sourceKind: row.sourceKind,
        mappingSource: row.mappingSource,
        isActive: row.isActive,
        advertId: row.advertId,
        views: row.views,
        clicks: row.clicks,
        orders: row.orders,
        addToCart: row.addToCart,
        shks: row.shks,
        updatedAt: row.updatedAt,
      } satisfies ProductClusterLookupMatch);
    }
    const byQueryStem = new Map<string, ProductClusterLookupMatch>();
    for (const row of authoritativeQueryRows) {
      const stemKey = this.buildAdvertisingStemKey(row.queryText);
      if (!stemKey || byQueryStem.has(stemKey)) {
        continue;
      }
      byQueryStem.set(stemKey, {
        queryText: row.queryText,
        clusterName: row.clusterName,
        sourceKind: row.sourceKind,
        mappingSource: row.mappingSource,
        isActive: row.isActive,
        advertId: row.advertId,
        views: row.views,
        clicks: row.clicks,
        orders: row.orders,
        addToCart: row.addToCart,
        shks: row.shks,
        updatedAt: row.updatedAt,
      } satisfies ProductClusterLookupMatch);
    }

    for (const row of exactClusterResult.rows) {
      const queryKey = this.normalizeAdvertisingIdentity(row.query_text);
      if (!byQuery.has(queryKey)) {
        const exactMatch: ProductClusterLookupMatch = {
          queryText: row.query_text,
          clusterName: row.cluster_name,
          sourceKind: row.source_kind,
          mappingSource: "cluster-name",
          isActive: row.is_active,
          advertId: row.advert_id === null ? null : Number(row.advert_id),
          views: row.views === null ? null : Number(row.views),
          clicks: row.clicks === null ? null : Number(row.clicks),
          orders: row.orders === null ? null : Number(row.orders),
          addToCart: row.add_to_cart === null ? null : Number(row.add_to_cart),
          shks: row.shks === null ? null : Number(row.shks),
          updatedAt: row.updated_at,
        };
        byQuery.set(queryKey, exactMatch);
        const stemKey = this.buildAdvertisingStemKey(row.query_text);
        if (stemKey && !byQueryStem.has(stemKey)) {
          byQueryStem.set(stemKey, exactMatch);
        }
      }
    }

    const matches: ProductClusterLookupMatch[] = [];

    for (const queryText of normalizedQueries) {
      const normalizedIdentity = this.normalizeAdvertisingIdentity(queryText);
      const stemKey = this.buildAdvertisingStemKey(queryText);
      const match =
        byQuery.get(normalizedIdentity) ??
        (stemKey ? byQueryStem.get(stemKey) : undefined);
      if (match) {
        matches.push(match);
      }
    }

    return matches;
  }
}
