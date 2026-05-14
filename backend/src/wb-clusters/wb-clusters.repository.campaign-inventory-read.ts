import type {
  StoredCampaignInventoryRow,
} from "./wb-clusters.repository.types";
import { WbClustersRepositoryCampaignPersistence } from "./wb-clusters.repository.campaign-persistence";
export abstract class WbClustersRepositoryCampaignInventoryRead extends WbClustersRepositoryCampaignPersistence {
  async getStoredCampaignInventory() {
    if (!this.isConfigured()) {
      return [] as Array<{
        advertId: number;
        campaignType: number;
        campaignStatus: number;
        paymentType: string | null;
        bidType: string | null;
        currency: string | null;
        name: string | null;
        changeTime: string | null;
        createdAtWb: string | null;
        startedAtWb: string | null;
        updatedAtWb: string | null;
        placementsSearch: boolean | null;
        placementsRecommendations: boolean | null;
        products: Array<{
          nmId: number;
          subjectId: number | null;
          subjectName: string | null;
          searchBid: number | null;
          minSearchBid: number | null;
        }>;
      }>;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<StoredCampaignInventoryRow>(
      `
        SELECT
          c.advert_id::text AS advert_id,
          c.campaign_type,
          c.campaign_status,
          c.payment_type,
          c.bid_type,
          c.currency,
          c.name,
          c.change_time::text AS change_time,
          c.created_at_wb::text AS created_at_wb,
          c.started_at_wb::text AS started_at_wb,
          c.updated_at_wb::text AS updated_at_wb,
          c.placements_search,
          c.placements_recommendations,
          cp.nm_id::text AS nm_id,
          cp.subject_id,
          cp.subject_name,
          cp.search_bid::text AS search_bid,
          cp.min_search_bid::text AS min_search_bid
        FROM ${this.tableName("wb_campaigns")} c
        LEFT JOIN ${this.tableName("wb_campaign_products")} cp
          ON cp.advert_id = c.advert_id
        ORDER BY c.advert_id, cp.nm_id
      `,
    );

    const inventory = new Map<
      number,
      {
        advertId: number;
        campaignType: number;
        campaignStatus: number;
        paymentType: string | null;
        bidType: string | null;
        currency: string | null;
        name: string | null;
        changeTime: string | null;
        createdAtWb: string | null;
        startedAtWb: string | null;
        updatedAtWb: string | null;
        placementsSearch: boolean | null;
        placementsRecommendations: boolean | null;
        products: Array<{
          nmId: number;
          subjectId: number | null;
          subjectName: string | null;
          searchBid: number | null;
          minSearchBid: number | null;
        }>;
      }
    >();

    for (const row of result.rows) {
      const advertId = Number(row.advert_id);
      if (!Number.isFinite(advertId)) {
        continue;
      }

      let entry = inventory.get(advertId);
      if (!entry) {
        entry = {
          advertId,
          campaignType: row.campaign_type,
          campaignStatus: row.campaign_status,
          paymentType: row.payment_type,
          bidType: row.bid_type,
          currency: row.currency,
          name: row.name,
          changeTime: row.change_time,
          createdAtWb: row.created_at_wb,
          startedAtWb: row.started_at_wb,
          updatedAtWb: row.updated_at_wb,
          placementsSearch: (row as { placements_search?: boolean | null }).placements_search ?? null,
          placementsRecommendations: (row as { placements_recommendations?: boolean | null }).placements_recommendations ?? null,
          products: [],
        };
        inventory.set(advertId, entry);
      }

      if (row.nm_id !== null) {
        const nmId = Number(row.nm_id);
        if (Number.isFinite(nmId)) {
          entry.products.push({
            nmId,
            subjectId: row.subject_id,
            subjectName: row.subject_name,
            searchBid: this.toNullableNumber(row.search_bid),
            minSearchBid: this.toNullableNumber(row.min_search_bid),
          });
        }
      }
    }

    return Array.from(inventory.values());
  }

  async getAllKnownNmIds(): Promise<number[]> {
    if (!this.isConfigured()) {
      return [];
    }
    const result = await this.getPool().query(
      `SELECT DISTINCT nm_id FROM ${this.tableName("wb_campaign_products")} WHERE nm_id IS NOT NULL ORDER BY nm_id`,
    );
    return result.rows.map((row: { nm_id: unknown }) => Number(row.nm_id));
  }

  /**
   * Returns nmIds that belong to at least one RUNNING (9) or READY (4) campaign.
   * Used by the JAM today-loop to prioritise active-RK products at the front of
   * every cycle so their search-text data is always the freshest.
   */
  async getActiveAdvertisingNmIds(): Promise<number[]> {
    if (!this.isConfigured()) {
      return [];
    }
    const result = await this.getPool().query(
      `
        SELECT DISTINCT cp.nm_id
        FROM ${this.tableName("wb_campaign_products")} cp
        JOIN ${this.tableName("wb_campaigns")} c ON c.advert_id = cp.advert_id
        WHERE c.campaign_status IN (4, 9)
          AND cp.nm_id IS NOT NULL
        ORDER BY cp.nm_id
      `,
    );
    return result.rows.map((row: { nm_id: unknown }) => Number(row.nm_id));
  }

  /**
   * Returns all known nmIds ordered for the JAM backfill:
   *   1. Active-RK products first (campaign_status IN (4, 9))
   *   2. Within each group: A → Z by vendor_code from wb_product_catalog
   *      (falls back to nm_id::text for products without a catalog entry)
   */
  async getJamBackfillQueue(): Promise<number[]> {
    if (!this.isConfigured()) {
      return [];
    }
    const result = await this.getPool().query<{ nm_id: string }>(
      `
        WITH product_groups AS (
          SELECT
            cp.nm_id,
            COALESCE(BOOL_OR(c.campaign_status IN (4, 9)), false) AS has_active_rk
          FROM ${this.tableName("wb_campaign_products")} cp
          LEFT JOIN ${this.tableName("wb_campaigns")} c ON c.advert_id = cp.advert_id
          WHERE cp.nm_id IS NOT NULL
          GROUP BY cp.nm_id
        )
        SELECT pg.nm_id::text AS nm_id
        FROM product_groups pg
        LEFT JOIN ${this.tableName("wb_product_catalog")} cat ON cat.nm_id = pg.nm_id
        ORDER BY
          CASE WHEN pg.has_active_rk THEN 0 ELSE 1 END,
          COALESCE(cat.vendor_code, pg.nm_id::text) ASC
      `,
    );
    return result.rows.map((row) => Number(row.nm_id));
  }

  /**
   * Returns the JAM backfill queue with per-product progress (days filled vs.
   * lookback window).  Used by the admin endpoint to monitor backfill status.
   */
  async getJamBackfillQueueStatus(lookbackDays = 30): Promise<
    Array<{
      position: number;
      group: "active_rk" | "no_rk";
      nmId: number;
      vendorCode: string | null;
      productName: string | null;
      daysFilled: number;
      daysTotal: number;
      isComplete: boolean;
    }>
  > {
    if (!this.isConfigured()) {
      return [];
    }
    const result = await this.getPool().query<{
      position: string;
      group_name: string;
      nm_id: string;
      vendor_code: string | null;
      product_name: string | null;
      days_filled: string;
      days_empty: string;
    }>(
      `
        WITH product_groups AS (
          SELECT
            cp.nm_id,
            COALESCE(BOOL_OR(c.campaign_status IN (4, 9)), false) AS has_active_rk
          FROM ${this.tableName("wb_campaign_products")} cp
          LEFT JOIN ${this.tableName("wb_campaigns")} c ON c.advert_id = cp.advert_id
          WHERE cp.nm_id IS NOT NULL
          GROUP BY cp.nm_id
        ),
        ordered AS (
          SELECT
            ROW_NUMBER() OVER (
              ORDER BY CASE WHEN pg.has_active_rk THEN 0 ELSE 1 END,
                       COALESCE(cat.vendor_code, pg.nm_id::text)
            ) AS position,
            CASE WHEN pg.has_active_rk THEN 'active_rk' ELSE 'no_rk' END AS group_name,
            pg.nm_id,
            cat.vendor_code,
            cat.product_name
          FROM product_groups pg
          LEFT JOIN ${this.tableName("wb_product_catalog")} cat ON cat.nm_id = pg.nm_id
        )
        SELECT
          o.position::text,
          o.group_name,
          o.nm_id::text AS nm_id,
          o.vendor_code,
          o.product_name,
          COUNT(CASE WHEN s.row_count > 0 THEN 1 END)::text AS days_filled,
          COUNT(CASE WHEN s.row_count = 0 THEN 1 END)::text AS days_empty
        FROM ordered o
        LEFT JOIN ${this.tableName("wb_product_search_text_range_snapshots")} s
          ON s.nm_id = o.nm_id
          AND s.start_date = s.end_date
          AND s.start_date >= (CURRENT_DATE - $1 * INTERVAL '1 day')::date
          AND s.end_date < CURRENT_DATE
        GROUP BY o.position, o.group_name, o.nm_id, o.vendor_code, o.product_name
        ORDER BY o.position
      `,
      [lookbackDays],
    );

    return result.rows.map((row) => {
      const daysFilled = Number(row.days_filled);
      const daysEmpty = Number(row.days_empty);
      return {
        position: Number(row.position),
        group: row.group_name as "active_rk" | "no_rk",
        nmId: Number(row.nm_id),
        vendorCode: row.vendor_code ?? null,
        productName: row.product_name ?? null,
        daysFilled,
        daysEmpty,
        daysTotal: lookbackDays,
        isComplete: daysFilled >= lookbackDays,
      };
    });
  }

  /**
   * Returns per-day JAM snapshot details for a single product.
   * Shows which specific dates are filled and whether each snapshot has real
   * rows (row_count > 0) so data quality can be verified.
   */
  async getJamSnapshotDetails(
    nmId: number,
    lookbackDays = 30,
  ): Promise<{
    nmId: number;
    checkedAt: string;
    lookbackDays: number;
    snapshots: Array<{
      date: string;
      rowCount: number;
      hasData: boolean;
      syncedAt: string;
    }>;
    summary: {
      daysWithData: number;
      daysEmpty: number;
      daysMissing: number;
      daysTotal: number;
    };
  }> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    const result = await pool.query<{
      date: string;
      row_count: string;
      synced_at: string;
    }>(
      `
        SELECT
          TO_CHAR(s.start_date, 'YYYY-MM-DD') AS date,
          s.row_count::text,
          s.synced_at::text
        FROM ${this.tableName("wb_product_search_text_range_snapshots")} s
        WHERE s.nm_id = $1
          AND s.start_date = s.end_date
          AND s.start_date >= (CURRENT_DATE - $2 * INTERVAL '1 day')::date
          AND s.end_date < CURRENT_DATE
        ORDER BY s.start_date DESC
      `,
      [nmId, lookbackDays],
    );

    const snapshots = result.rows.map((row) => ({
      date: row.date,
      rowCount: Number(row.row_count),
      hasData: Number(row.row_count) > 0,
      syncedAt: row.synced_at,
    }));

    const daysWithData = snapshots.filter((s) => s.hasData).length;
    const daysEmpty = snapshots.filter((s) => !s.hasData).length;
    const daysMissing = lookbackDays - snapshots.length;

    return {
      nmId,
      checkedAt: new Date().toISOString(),
      lookbackDays,
      snapshots,
      summary: {
        daysWithData,
        daysEmpty,
        daysMissing,
        daysTotal: lookbackDays,
      },
    };
  }

}
