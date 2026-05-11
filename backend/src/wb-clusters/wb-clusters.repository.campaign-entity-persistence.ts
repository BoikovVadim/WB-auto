import { WbClustersRepositoryCampaignActionPersistence } from "./wb-clusters.repository.campaign-action-persistence";
export abstract class WbClustersRepositoryCampaignEntityPersistence extends WbClustersRepositoryCampaignActionPersistence {
  async upsertCampaign(input: {
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
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    await pool.query(
      `
        INSERT INTO ${this.tableName("wb_campaigns")} (
          advert_id,
          campaign_type,
          campaign_status,
          payment_type,
          bid_type,
          currency,
          name,
          change_time,
          created_at_wb,
          started_at_wb,
          updated_at_wb,
          synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        ON CONFLICT (advert_id) DO UPDATE
        SET
          campaign_type = EXCLUDED.campaign_type,
          campaign_status = EXCLUDED.campaign_status,
          payment_type = EXCLUDED.payment_type,
          bid_type = EXCLUDED.bid_type,
          currency = EXCLUDED.currency,
          name = EXCLUDED.name,
          change_time = EXCLUDED.change_time,
          created_at_wb = EXCLUDED.created_at_wb,
          started_at_wb = EXCLUDED.started_at_wb,
          updated_at_wb = EXCLUDED.updated_at_wb,
          synced_at = NOW()
      `,
      [
        input.advertId,
        input.campaignType,
        input.campaignStatus,
        input.paymentType,
        input.bidType,
        input.currency,
        input.name,
        input.changeTime,
        input.createdAtWb,
        input.startedAtWb,
        input.updatedAtWb,
      ],
    );
  }

  async replaceCampaignProducts(
    advertId: number,
    products: Array<{
      nmId: number;
      subjectId: number | null;
      subjectName: string | null;
      searchBid: number | null;
    }>,
  ) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    await pool.query(
      `DELETE FROM ${this.tableName("wb_campaign_products")} WHERE advert_id = $1`,
      [advertId],
    );

    for (const product of products) {
      await pool.query(
        `
          INSERT INTO ${this.tableName("wb_campaign_products")} (
            advert_id,
            nm_id,
            subject_id,
            subject_name,
            search_bid,
            search_bid_synced_at,
            synced_at
          ) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
          ON CONFLICT (advert_id, nm_id) DO UPDATE
          SET
            subject_id = EXCLUDED.subject_id,
            subject_name = EXCLUDED.subject_name,
            search_bid = EXCLUDED.search_bid,
            search_bid_synced_at = EXCLUDED.search_bid_synced_at,
            synced_at = NOW()
        `,
        [advertId, product.nmId, product.subjectId, product.subjectName, product.searchBid],
      );
    }
  }

  async upsertCampaignProductSearchBid(input: {
    advertId: number;
    nmId: number;
    searchBid: number | null;
    syncedAt?: string | null;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    await pool.query(
      `
        INSERT INTO ${this.tableName("wb_campaign_products")} (
          advert_id,
          nm_id,
          search_bid,
          search_bid_synced_at,
          synced_at
        ) VALUES ($1,$2,$3,$4,NOW())
        ON CONFLICT (advert_id, nm_id) DO UPDATE
        SET
          search_bid = EXCLUDED.search_bid,
          search_bid_synced_at = EXCLUDED.search_bid_synced_at,
          synced_at = NOW()
      `,
      [
        input.advertId,
        input.nmId,
        input.searchBid,
        input.syncedAt ?? new Date().toISOString(),
      ],
    );
  }

  async upsertCampaignProductMinSearchBids(
    items: Array<{
      advertId: number;
      nmId: number;
      minSearchBid: number | null;
      syncedAt?: string | null;
    }>,
  ) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    for (const item of items) {
      await pool.query(
        `
          INSERT INTO ${this.tableName("wb_campaign_products")} (
            advert_id,
            nm_id,
            min_search_bid,
            min_search_bid_synced_at,
            synced_at
          ) VALUES ($1,$2,$3,$4,NOW())
          ON CONFLICT (advert_id, nm_id) DO UPDATE
          SET
            min_search_bid = EXCLUDED.min_search_bid,
            min_search_bid_synced_at = EXCLUDED.min_search_bid_synced_at,
            synced_at = NOW()
        `,
        [
          item.advertId,
          item.nmId,
          item.minSearchBid,
          item.syncedAt ?? new Date().toISOString(),
        ],
      );
    }
  }

  async backfillMissingCampaignProductSearchBidsFromArchives(input?: {
    nmId?: number;
    advertIds?: number[];
  }) {
    const conditions = [`cp.search_bid IS NULL`];
    const params: Array<number | number[]> = [];

    if (typeof input?.nmId === "number") {
      params.push(input.nmId);
      conditions.push(`cp.nm_id = $${params.length}`);
    }

    if (Array.isArray(input?.advertIds) && input.advertIds.length > 0) {
      params.push(input.advertIds);
      conditions.push(`cp.advert_id = ANY($${params.length}::bigint[])`);
    }

    await this.getPool().query(
      `
        WITH archive_matches AS (
          SELECT
            (advert.value->>'id')::bigint AS advert_id,
            (nm.value->>'nm_id')::bigint AS nm_id,
            CASE
              WHEN jsonb_typeof(nm.value->'bids_kopecks'->'search') IN ('number', 'string')
              THEN ((nm.value->'bids_kopecks'->>'search')::numeric / 100)
              ELSE NULL
            END AS search_bid,
            archive.created_at,
            ROW_NUMBER() OVER (
              PARTITION BY (advert.value->>'id')::bigint, (nm.value->>'nm_id')::bigint
              ORDER BY archive.created_at DESC
            ) AS row_number
          FROM ${this.tableName("wb_cluster_raw_archive")} archive
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(archive.payload->'adverts') = 'array'
              THEN archive.payload->'adverts'
              ELSE '[]'::jsonb
            END
          ) AS advert(value)
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(advert.value->'nm_settings') = 'array'
              THEN advert.value->'nm_settings'
              ELSE '[]'::jsonb
            END
          ) AS nm(value)
        )
        UPDATE ${this.tableName("wb_campaign_products")} cp
        SET
          search_bid = archive_matches.search_bid,
          search_bid_synced_at = COALESCE(cp.search_bid_synced_at, archive_matches.created_at),
          synced_at = GREATEST(cp.synced_at, archive_matches.created_at)
        FROM archive_matches
        WHERE archive_matches.row_number = 1
          AND archive_matches.search_bid IS NOT NULL
          AND cp.advert_id = archive_matches.advert_id
          AND cp.nm_id = archive_matches.nm_id
          AND ${conditions.join("\n          AND ")}
      `,
      params,
    );
  }

}
