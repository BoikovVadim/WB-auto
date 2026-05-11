import { WbClustersRepositoryClusterStatsWrite } from "./wb-clusters.repository.cluster-stats-write";

export abstract class WbClustersRepositoryClusterAnalyticsPersistence extends WbClustersRepositoryClusterStatsWrite {
  async replaceClusterDailyStats(input: {
    advertId: number;
    nmId: number;
    from: string;
    to: string;
    rows: Array<{
      date: string;
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
    }>;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM ${this.tableName("wb_cluster_daily_stats")}
          WHERE advert_id = $1
            AND nm_id = $2
            AND stat_date BETWEEN $3::date AND $4::date
        `,
        [input.advertId, input.nmId, input.from, input.to],
      );

      if (input.rows.length > 0) {
        await client.query(
          `
            INSERT INTO ${this.tableName("wb_cluster_daily_stats")} (
              daily_stat_key,
              advert_id,
              nm_id,
              stat_date,
              cluster_name,
              normalized_cluster_name,
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
              daily_stat_key,
              advert_id,
              nm_id,
              stat_date::date,
              cluster_name,
              normalized_cluster_name,
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
              $5::text[],
              $6::text[],
              $7::numeric[],
              $8::numeric[],
              $9::numeric[],
              $10::numeric[],
              $11::numeric[],
              $12::numeric[],
              $13::numeric[],
              $14::numeric[],
              $15::numeric[],
              $16::numeric[],
              $17::text[]
            ) AS rows(
              daily_stat_key,
              advert_id,
              nm_id,
              stat_date,
              cluster_name,
              normalized_cluster_name,
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
            ON CONFLICT (daily_stat_key) DO UPDATE
            SET
              cluster_name = EXCLUDED.cluster_name,
              normalized_cluster_name = EXCLUDED.normalized_cluster_name,
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
            input.rows.map((row) =>
              this.buildDatedScopedTextKey(
                input.advertId,
                input.nmId,
                row.date,
                row.clusterName,
              ),
            ),
            input.rows.map(() => input.advertId),
            input.rows.map(() => input.nmId),
            input.rows.map((row) => row.date),
            input.rows.map((row) => row.clusterName),
            input.rows.map((row) => this.normalizeQuery(row.clusterName)),
            input.rows.map((row) => row.views),
            input.rows.map((row) => row.clicks),
            input.rows.map((row) => row.orders),
            input.rows.map((row) => row.addToCart),
            input.rows.map((row) => row.shks),
            input.rows.map((row) => row.ctr),
            input.rows.map((row) => row.avgPosition),
            input.rows.map((row) => row.cpc),
            input.rows.map((row) => row.cpm),
            input.rows.map((row) => row.spend),
            input.rows.map((row) => row.currency),
          ],
        );
      }

      await client.query("COMMIT");
      return input.rows.length;
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async replaceKeywordStats(input: {
    advertId: number;
    from: string;
    to: string;
    rows: Array<{
      date: string;
      keyword: string;
      views: number | null;
      clicks: number | null;
      ctr: number | null;
      spend: number | null;
      currency: string | null;
    }>;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM ${this.tableName("wb_keyword_stats")}
          WHERE advert_id = $1
            AND stat_date BETWEEN $2::date AND $3::date
        `,
        [input.advertId, input.from, input.to],
      );

      for (const row of input.rows) {
        const keywordStatKey = this.buildDatedTextKey(
          input.advertId,
          row.date,
          row.keyword,
        );
        await client.query(
          `
            INSERT INTO ${this.tableName("wb_keyword_stats")} (
              keyword_stat_key,
              advert_id,
              stat_date,
              keyword,
              normalized_keyword,
              views,
              clicks,
              ctr,
              spend,
              currency,
              synced_at
            ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,NOW())
            ON CONFLICT (keyword_stat_key) DO UPDATE
            SET
              keyword = EXCLUDED.keyword,
              normalized_keyword = EXCLUDED.normalized_keyword,
              views = EXCLUDED.views,
              clicks = EXCLUDED.clicks,
              ctr = EXCLUDED.ctr,
              spend = EXCLUDED.spend,
              currency = EXCLUDED.currency,
              synced_at = NOW()
          `,
          [
            keywordStatKey,
            input.advertId,
            row.date,
            row.keyword,
            this.normalizeQuery(row.keyword),
            row.views,
            row.clicks,
            row.ctr,
            row.spend,
            row.currency,
          ],
        );
      }

      await client.query("COMMIT");
      return input.rows.length;
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

}
