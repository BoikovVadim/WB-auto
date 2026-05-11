import type { Pool } from "pg";

import { WbClustersRepositoryAdvertisingSheetQueryMapLoader } from "./wb-clusters.repository.advertising-sheet-query-map-loader";

export abstract class WbClustersRepositoryAdvertisingSheetMetricsQueryLoader extends WbClustersRepositoryAdvertisingSheetQueryMapLoader {
  protected async loadProductAdvertisingSheetMetricsRows(pool: Pool, nmId: number, currentPeriod: { start: string; end: string } | null) {
    const [dailyStatsResult, minusPhrasesResult, keywordStatsResult] = await Promise.all([
      pool.query<{
          advert_id: string;
          stat_date: string;
          cluster_name: string;
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
          currency: string | null;
          updated_at: string | null;
          }>(
          `
          SELECT
          advert_id::text AS advert_id,
          stat_date::text AS stat_date,
          cluster_name,
          views::text AS views,
          clicks::text AS clicks,
          orders::text AS orders,
          add_to_cart::text AS add_to_cart,
          shks::text AS shks,
          ctr::text AS ctr,
          avg_position::text AS avg_position,
          cpc::text AS cpc,
          cpm::text AS cpm,
          spend::text AS spend,
          currency,
          synced_at::text AS updated_at
          FROM ${this.tableName("wb_cluster_daily_stats")}
          WHERE nm_id = $1
          AND ($2::date IS NULL OR stat_date BETWEEN $2::date AND $3::date)
          ORDER BY stat_date DESC, advert_id, cluster_name
          `,
          [nmId, currentPeriod?.start ?? null, currentPeriod?.end ?? null],
          )
      ,
      pool.query<{
          advert_id: string;
          phrase: string;
          updated_at: string | null;
          }>(
          `
          SELECT
          advert_id::text AS advert_id,
          phrase,
          synced_at::text AS updated_at
          FROM ${this.tableName("wb_campaign_minus_phrases")}
          WHERE nm_id = $1
          ORDER BY advert_id, phrase
          `,
          [nmId],
          )
      ,
      pool.query<{
          advert_id: string;
          stat_date: string;
          keyword: string;
          views: string | null;
          clicks: string | null;
          ctr: string | null;
          spend: string | null;
          currency: string | null;
          updated_at: string | null;
          }>(
          `
          SELECT
          ks.advert_id::text AS advert_id,
          ks.stat_date::text AS stat_date,
          ks.keyword,
          ks.views::text AS views,
          ks.clicks::text AS clicks,
          ks.ctr::text AS ctr,
          ks.spend::text AS spend,
          ks.currency,
          ks.synced_at::text AS updated_at
          FROM ${this.tableName("wb_keyword_stats")} ks
          WHERE EXISTS (
          SELECT 1
          FROM ${this.tableName("wb_campaign_products")} cp
          WHERE cp.advert_id = ks.advert_id
          AND cp.nm_id = $1
          )
          AND ($2::date IS NULL OR ks.stat_date BETWEEN $2::date AND $3::date)
          ORDER BY ks.stat_date DESC, ks.advert_id, ks.keyword
          `,
          [nmId, currentPeriod?.start ?? null, currentPeriod?.end ?? null],
          )
      ,
    ]);
    return {
      dailyStatsResult,
      minusPhrasesResult,
      keywordStatsResult,
    };
  }

}
