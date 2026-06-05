import type {
  StoredProductCatalogRow,
} from "./wb-clusters.repository.types";
import type { ProductCatalogItem } from "./wb-clusters.types";
import { WbClustersRepositoryProductSheetStorage } from "./wb-clusters.repository.product-sheet-storage";
export abstract class WbClustersRepositoryCatalogStorage extends WbClustersRepositoryProductSheetStorage {
  async upsertProductCatalogItems(input: {
    items: Array<{
      nmId: number;
      vendorCode: string;
      name: string;
      brandName: string;
      subjectName: string;
    }>;
    sourceExportRequestId?: string | null;
    seenAt?: string | null;
  }) {
    if (input.items.length === 0) {
      return 0;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    let upsertedCount = 0;
    const seenAt = input.seenAt ?? new Date().toISOString();

    for (const item of input.items) {
      await pool.query(
        `
          INSERT INTO ${this.tableName("wb_product_catalog")} (
            nm_id,
            vendor_code,
            product_name,
            brand_name,
            subject_name,
            source_export_request_id,
            first_seen_at,
            last_seen_at,
            synced_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$7::timestamptz,NOW())
          ON CONFLICT (nm_id) DO UPDATE
          SET
            vendor_code = CASE
              WHEN ${this.tableName("wb_product_catalog")}.last_seen_at IS NULL
                OR $7::timestamptz >= ${this.tableName("wb_product_catalog")}.last_seen_at
                THEN EXCLUDED.vendor_code
              ELSE ${this.tableName("wb_product_catalog")}.vendor_code
            END,
            product_name = CASE
              WHEN ${this.tableName("wb_product_catalog")}.last_seen_at IS NULL
                OR $7::timestamptz >= ${this.tableName("wb_product_catalog")}.last_seen_at
                THEN EXCLUDED.product_name
              ELSE ${this.tableName("wb_product_catalog")}.product_name
            END,
            brand_name = CASE
              WHEN ${this.tableName("wb_product_catalog")}.last_seen_at IS NULL
                OR $7::timestamptz >= ${this.tableName("wb_product_catalog")}.last_seen_at
                THEN EXCLUDED.brand_name
              ELSE ${this.tableName("wb_product_catalog")}.brand_name
            END,
            subject_name = CASE
              WHEN ${this.tableName("wb_product_catalog")}.last_seen_at IS NULL
                OR $7::timestamptz >= ${this.tableName("wb_product_catalog")}.last_seen_at
                THEN EXCLUDED.subject_name
              ELSE ${this.tableName("wb_product_catalog")}.subject_name
            END,
            source_export_request_id = CASE
              WHEN ${this.tableName("wb_product_catalog")}.last_seen_at IS NULL
                OR $7::timestamptz >= ${this.tableName("wb_product_catalog")}.last_seen_at
                THEN EXCLUDED.source_export_request_id
              ELSE ${this.tableName("wb_product_catalog")}.source_export_request_id
            END,
            first_seen_at = COALESCE(${this.tableName("wb_product_catalog")}.first_seen_at, EXCLUDED.first_seen_at),
            last_seen_at = GREATEST(
              COALESCE(${this.tableName("wb_product_catalog")}.last_seen_at, $7::timestamptz),
              $7::timestamptz
            ),
            synced_at = NOW()
        `,
        [
          item.nmId,
          item.vendorCode,
          item.name,
          item.brandName,
          item.subjectName,
          input.sourceExportRequestId ?? null,
          seenAt,
        ],
      );
      upsertedCount += 1;
    }

    return upsertedCount;
  }

  /**
   * Bulk-updates category_name for all products matching a given subject_name.
   * Called after fetching the WB /content/v2/object/all subject→category mapping.
   */
  async updateCategoryNamesBySubject(
    mapping: Map<string, { categoryName: string; subjectId?: number | null }>,
  ): Promise<number> {
    if (mapping.size === 0) return 0;
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    let updatedCount = 0;
    for (const [subjectName, { categoryName, subjectId }] of mapping) {
      const result = await pool.query(
        `UPDATE ${this.tableName("wb_product_catalog")}
         SET category_name = $1, subject_id = COALESCE($2, subject_id)
         WHERE subject_name = $3`,
        [categoryName, subjectId ?? null, subjectName],
      );
      updatedCount += result.rowCount ?? 0;
    }
    return updatedCount;
  }

  async getSubjectIdsByCategory(): Promise<Map<string, number[]>> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{ category_name: string; subject_id: string }>(
      `SELECT DISTINCT category_name, subject_id::text AS subject_id
       FROM ${this.tableName("wb_product_catalog")}
       WHERE category_name IS NOT NULL
         AND subject_id IS NOT NULL
       ORDER BY category_name`,
    );
    const map = new Map<string, number[]>();
    for (const row of result.rows) {
      const id = Number(row.subject_id);
      if (!Number.isFinite(id)) continue;
      const existing = map.get(row.category_name) ?? [];
      existing.push(id);
      map.set(row.category_name, existing);
    }
    return map;
  }

  async listProductCatalogItems(): Promise<ProductCatalogItem[]> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    // Query 1: Catalog products with campaign counts (original query, unchanged).
    // Only return products that have a real vendor_code from the WB catalog.
    // Products that appear only in campaigns (no catalog entry) are excluded.
    const catalogResult = await pool.query<
      StoredProductCatalogRow & {
        campaign_total: string;
        campaign_active: string;
        campaign_paused: string;
        campaign_disabled: string;
      }
    >(
      `
        SELECT
          p.nm_id::text AS nm_id,
          p.vendor_code,
          p.product_name,
          p.brand_name,
          p.subject_name,
          p.subject_id::text AS subject_id,
          p.category_name,
          p.source_export_request_id,
          p.first_seen_at::text AS first_seen_at,
          p.last_seen_at::text  AS last_seen_at,
          p.synced_at::text     AS synced_at,
          COALESCE(cc.total, 0)::text    AS campaign_total,
          COALESCE(cc.active, 0)::text   AS campaign_active,
          COALESCE(cc.paused, 0)::text   AS campaign_paused,
          COALESCE(cc.disabled, 0)::text AS campaign_disabled
        FROM ${this.tableName("wb_product_catalog")} p
        LEFT JOIN (
          SELECT
            cp.nm_id,
            COUNT(DISTINCT c.advert_id)                                                      AS total,
            COUNT(DISTINCT CASE WHEN c.campaign_status = 9  THEN c.advert_id END)           AS active,
            COUNT(DISTINCT CASE WHEN c.campaign_status = 11 THEN c.advert_id END)           AS paused,
            COUNT(DISTINCT CASE WHEN c.campaign_status NOT IN (9, 11) THEN c.advert_id END) AS disabled
          FROM ${this.tableName("wb_campaign_products")} cp
          JOIN ${this.tableName("wb_campaigns")} c ON c.advert_id = cp.advert_id
          GROUP BY cp.nm_id
        ) cc ON cc.nm_id = p.nm_id
        WHERE p.vendor_code <> ''
        ORDER BY LOWER(p.vendor_code), p.nm_id
      `,
    );

    return catalogResult.rows
      .map((row) => ({
        nmId: Number(row.nm_id),
        vendorCode: row.vendor_code,
        name: row.product_name,
        brandName: row.brand_name,
        subjectName: row.subject_name,
        subjectId: row.subject_id != null ? Number(row.subject_id) : null,
        categoryName: row.category_name ?? null,
        sourceExportRequestId: row.source_export_request_id,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        syncedAt: row.synced_at,
        campaignCounts: {
          total: Number(row.campaign_total),
          active: Number(row.campaign_active),
          paused: Number(row.campaign_paused),
          disabled: Number(row.campaign_disabled),
        },
      }))
      .filter((item) => Number.isFinite(item.nmId));
  }

  async getDistinctSubjectNames(): Promise<string[]> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{ subject_name: string }>(
      `SELECT DISTINCT subject_name FROM ${this.tableName("wb_product_catalog")}
       WHERE subject_name <> '' AND subject_name <> '-'
       ORDER BY subject_name`,
    );
    return result.rows.map((r) => r.subject_name);
  }

  async getKnownCatalogNmIds(): Promise<number[]> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{ nm_id: string }>(
      `SELECT nm_id::text AS nm_id FROM ${this.tableName("wb_product_catalog")} WHERE vendor_code <> '' ORDER BY nm_id`,
    );
    return result.rows.map((r) => Number(r.nm_id)).filter(Number.isFinite);
  }

  /**
   * Сколько строк «вселенной запросов» (wb_cabinet_cluster_queries) у каждого товара.
   * Сборка листа товара тянет ВСЕ эти строки в JS-память, поэтому ночной precompute
   * по счётчику пропускает товары-монстры (иначе одна сборка пробивает heap → FATAL OOM
   * и падает весь бэкенд). Дёшево: покрыто индексом по nm_id. Возвращает Map nmId→count.
   */
  async getCabinetClusterQueryCountsByNmId(nmIds: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    const ids = Array.from(new Set(nmIds.filter((v) => Number.isInteger(v) && v > 0)));
    if (ids.length === 0) {
      return counts;
    }
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{ nm_id: string; cnt: string }>(
      `SELECT nm_id::text AS nm_id, COUNT(*)::text AS cnt
         FROM ${this.tableName("wb_cabinet_cluster_queries")}
        WHERE nm_id = ANY($1::bigint[])
        GROUP BY nm_id`,
      [ids],
    );
    for (const row of result.rows) {
      const nmId = Number(row.nm_id);
      const cnt = Number(row.cnt);
      if (Number.isFinite(nmId) && Number.isFinite(cnt)) {
        counts.set(nmId, cnt);
      }
    }
    return counts;
  }

  async getMissingCatalogNmIds(): Promise<number[]> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{ nm_id: string }>(
      `SELECT DISTINCT cp.nm_id::text AS nm_id
       FROM ${this.tableName("wb_campaign_products")} cp
       WHERE cp.nm_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM ${this.tableName("wb_product_catalog")} cat
           WHERE cat.nm_id = cp.nm_id
             AND cat.vendor_code <> ''
         )
       ORDER BY nm_id`,
    );
    return result.rows.map((r) => Number(r.nm_id)).filter(Number.isFinite);
  }

  async getProductCatalogItemByNmId(nmId: number): Promise<ProductCatalogItem | null> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<
      StoredProductCatalogRow & {
        campaign_total: string;
        campaign_active: string;
        campaign_paused: string;
        campaign_disabled: string;
      }
    >(
      `
        SELECT
          p.nm_id::text AS nm_id,
          p.vendor_code,
          p.product_name,
          p.brand_name,
          p.subject_name,
          p.subject_id::text AS subject_id,
          p.category_name,
          p.source_export_request_id,
          p.first_seen_at::text AS first_seen_at,
          p.last_seen_at::text AS last_seen_at,
          p.synced_at::text AS synced_at,
          COALESCE(cc.total, 0)::text    AS campaign_total,
          COALESCE(cc.active, 0)::text   AS campaign_active,
          COALESCE(cc.paused, 0)::text   AS campaign_paused,
          COALESCE(cc.disabled, 0)::text AS campaign_disabled
        FROM ${this.tableName("wb_product_catalog")} p
        LEFT JOIN (
          SELECT
            cp.nm_id,
            COUNT(DISTINCT c.advert_id)                                                              AS total,
            COUNT(DISTINCT CASE WHEN c.campaign_status = 9  THEN c.advert_id END)                   AS active,
            COUNT(DISTINCT CASE WHEN c.campaign_status = 11 THEN c.advert_id END)                   AS paused,
            COUNT(DISTINCT CASE WHEN c.campaign_status NOT IN (9, 11) THEN c.advert_id END)         AS disabled
          FROM ${this.tableName("wb_campaign_products")} cp
          JOIN ${this.tableName("wb_campaigns")} c ON c.advert_id = cp.advert_id
          WHERE cp.nm_id = $1
          GROUP BY cp.nm_id
        ) cc ON cc.nm_id = p.nm_id
        WHERE p.nm_id = $1
        LIMIT 1
      `,
      [nmId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const parsedNmId = Number(row.nm_id);
    if (!Number.isFinite(parsedNmId)) {
      return null;
    }

    return {
      nmId: parsedNmId,
      vendorCode: row.vendor_code,
      name: row.product_name,
      brandName: row.brand_name,
      subjectName: row.subject_name,
      subjectId: row.subject_id != null ? Number(row.subject_id) : null,
      categoryName: row.category_name ?? null,
      sourceExportRequestId: row.source_export_request_id,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      syncedAt: row.synced_at,
      campaignCounts: {
        total: Number(row.campaign_total),
        active: Number(row.campaign_active),
        paused: Number(row.campaign_paused),
        disabled: Number(row.campaign_disabled),
      },
    };
  }

  /**
   * Returns a lightweight campaign list for a product — no PATH B required.
   * Used to build an instant workspace shell when no snapshot exists yet.
   */
  async getProductCampaignSummaries(nmId: number): Promise<
    Array<{
      advertId: number;
      name: string | null;
      campaignType: number | null;
      campaignStatus: number | null;
      paymentType: string | null;
      bidType: string | null;
      placementsSearch: boolean | null;
      placementsRecommendations: boolean | null;
      currency: string | null;
      syncedAt: string | null;
    }>
  > {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{
      advert_id: string;
      name: string | null;
      campaign_type: number | null;
      campaign_status: number | null;
      payment_type: string | null;
      bid_type: string | null;
      placements_search: boolean | null;
      placements_recommendations: boolean | null;
      currency: string | null;
      synced_at: string | null;
    }>(
      `
        SELECT
          c.advert_id::text AS advert_id,
          c.name,
          c.campaign_type,
          c.campaign_status,
          c.payment_type,
          c.bid_type,
          c.placements_search,
          c.placements_recommendations,
          c.currency,
          GREATEST(c.synced_at, cp.synced_at)::text AS synced_at
        FROM ${this.tableName("wb_campaign_products")} cp
        JOIN ${this.tableName("wb_campaigns")} c ON c.advert_id = cp.advert_id
        WHERE cp.nm_id = $1
        ORDER BY
          CASE WHEN c.campaign_status = 9 THEN 0
               WHEN c.campaign_status = 11 THEN 1
               ELSE 2 END,
          c.advert_id DESC
      `,
      [nmId],
    );
    return result.rows.map((row) => ({
      advertId: Number(row.advert_id),
      name: row.name,
      campaignType: row.campaign_type,
      campaignStatus: row.campaign_status,
      paymentType: row.payment_type,
      bidType: row.bid_type,
      placementsSearch: row.placements_search,
      placementsRecommendations: row.placements_recommendations,
      currency: row.currency,
      syncedAt: row.synced_at,
    }));
  }

}
