import { WbClustersRepositoryClusterPersistence } from "./wb-clusters.repository.cluster-persistence";

export abstract class WbClustersRepositoryClusterStatsWrite extends WbClustersRepositoryClusterPersistence {
  async upsertClusterStats(input: {
    advertId: number | null;
    nmId: number;
    clusterName: string;
    views: number | null;
    clicks: number | null;
    orders: number | null;
    addToCart: number | null;
    shks: number | null;
    ctr: number | null;
    avgPosition: number | null;
    cpc: number | null;
    cpm: number | null;
    spend: number | null;
    currency: string | null;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const clusterKey = this.buildClusterKey(input.nmId, input.clusterName, "stats");

    await this.upsertCluster({
      advertId: input.advertId,
      nmId: input.nmId,
      clusterName: input.clusterName,
      sourceKind: "stats",
      isActive: true,
    });

    await pool.query(
      `
        INSERT INTO ${this.tableName("wb_cluster_stats")} (
          cluster_key,
          advert_id,
          nm_id,
          cluster_name,
          views,
          clicks,
          orders,
          add_to_cart,
          shks,
          ctr,
          avg_position,
          cpc,
          cpm,
          spend,
          currency,
          synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
        ON CONFLICT (cluster_key) DO UPDATE
        SET
          advert_id = EXCLUDED.advert_id,
          nm_id = EXCLUDED.nm_id,
          cluster_name = EXCLUDED.cluster_name,
          views = EXCLUDED.views,
          clicks = EXCLUDED.clicks,
          orders = EXCLUDED.orders,
          add_to_cart = EXCLUDED.add_to_cart,
          shks = EXCLUDED.shks,
          ctr = EXCLUDED.ctr,
          avg_position = EXCLUDED.avg_position,
          cpc = EXCLUDED.cpc,
          cpm = EXCLUDED.cpm,
          spend = EXCLUDED.spend,
          currency = EXCLUDED.currency,
          synced_at = NOW()
      `,
      [
        clusterKey,
        input.advertId,
        input.nmId,
        input.clusterName,
        input.views,
        input.clicks,
        input.orders,
        input.addToCart,
        input.shks,
        input.ctr,
        input.avgPosition,
        input.cpc,
        input.cpm,
        input.spend,
        input.currency,
      ],
    );
  }

  async upsertClusterStatsBulk(
    inputs: Array<{
      advertId: number | null;
      nmId: number;
      clusterName: string;
      views: number | null;
      clicks: number | null;
      orders: number | null;
      addToCart: number | null;
      shks: number | null;
      ctr: number | null;
      avgPosition: number | null;
      cpc: number | null;
      cpm: number | null;
      spend: number | null;
      currency: string | null;
    }>,
  ) {
    if (inputs.length === 0) {
      return 0;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();
    const deduplicatedInputs = Array.from(
      new Map(
        inputs.map((input) => [
          this.buildClusterKey(input.nmId, input.clusterName, "stats"),
          input,
        ]),
      ).values(),
    );

    try {
      await client.query("BEGIN");
      await this.upsertClusters(
        deduplicatedInputs.map((input) => ({
          advertId: input.advertId,
          nmId: input.nmId,
          clusterName: input.clusterName,
          sourceKind: "stats",
          isActive: true,
        })),
        client,
      );

      await client.query(
        `
          INSERT INTO ${this.tableName("wb_cluster_stats")} (
            cluster_key,
            advert_id,
            nm_id,
            cluster_name,
            views,
            clicks,
            orders,
            add_to_cart,
            shks,
            ctr,
            avg_position,
            cpc,
            cpm,
            spend,
            currency,
            synced_at
          )
          SELECT
            cluster_key,
            advert_id,
            nm_id,
            cluster_name,
            views,
            clicks,
            orders,
            add_to_cart,
            shks,
            ctr,
            avg_position,
            cpc,
            cpm,
            spend,
            currency,
            NOW()
          FROM UNNEST(
            $1::text[],
            $2::bigint[],
            $3::bigint[],
            $4::text[],
            $5::numeric[],
            $6::numeric[],
            $7::numeric[],
            $8::numeric[],
            $9::numeric[],
            $10::numeric[],
            $11::numeric[],
            $12::numeric[],
            $13::numeric[],
            $14::numeric[],
            $15::text[]
          ) AS rows(
            cluster_key,
            advert_id,
            nm_id,
            cluster_name,
            views,
            clicks,
            orders,
            add_to_cart,
            shks,
            ctr,
            avg_position,
            cpc,
            cpm,
            spend,
            currency
          )
          ON CONFLICT (cluster_key) DO UPDATE
          SET
            advert_id = EXCLUDED.advert_id,
            nm_id = EXCLUDED.nm_id,
            cluster_name = EXCLUDED.cluster_name,
            views = EXCLUDED.views,
            clicks = EXCLUDED.clicks,
            orders = EXCLUDED.orders,
            add_to_cart = EXCLUDED.add_to_cart,
            shks = EXCLUDED.shks,
            ctr = EXCLUDED.ctr,
            avg_position = EXCLUDED.avg_position,
            cpc = EXCLUDED.cpc,
            cpm = EXCLUDED.cpm,
            spend = EXCLUDED.spend,
            currency = EXCLUDED.currency,
            synced_at = NOW()
        `,
        [
          deduplicatedInputs.map((input) =>
            this.buildClusterKey(input.nmId, input.clusterName, "stats"),
          ),
          deduplicatedInputs.map((input) => input.advertId),
          deduplicatedInputs.map((input) => input.nmId),
          deduplicatedInputs.map((input) => input.clusterName),
          deduplicatedInputs.map((input) => input.views),
          deduplicatedInputs.map((input) => input.clicks),
          deduplicatedInputs.map((input) => input.orders),
          deduplicatedInputs.map((input) => input.addToCart),
          deduplicatedInputs.map((input) => input.shks),
          deduplicatedInputs.map((input) => input.ctr),
          deduplicatedInputs.map((input) => input.avgPosition),
          deduplicatedInputs.map((input) => input.cpc),
          deduplicatedInputs.map((input) => input.cpm),
          deduplicatedInputs.map((input) => input.spend),
          deduplicatedInputs.map((input) => input.currency),
        ],
      );

      await client.query("COMMIT");
      return deduplicatedInputs.length;
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

}
