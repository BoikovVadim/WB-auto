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

}
