import { WbClustersRepositoryStocks } from "./wb-clusters.repository.stocks";

export type DailyPricesRow = {
  nmId: number;
  priceDate: string;  // "YYYY-MM-DD"
  price: number;      // full price in RUB
  discount: number;   // seller discount, %
};

export type PriceChangeSyncStatus =
  | "queued"
  | "sending"
  | "pending"
  | "throttled"
  | "confirmed"
  | "failed";

export type PriceChangeRow = {
  nmId: number;
  desiredBasePrice: number;
  desiredDiscount: number;
  desiredFinal: number;
  syncStatus: PriceChangeSyncStatus;
  uploadId: number | null;
  /** Фактический итог «со скидкой», который сейчас в кабинете WB (из readback). */
  observedFinal: number | null;
  confirmedAt: string | null;
  retryAt: string | null;
  lastError: string | null;
  attemptCount: number;
  updatedAt: string;
};

export abstract class WbClustersRepositoryPrices extends WbClustersRepositoryStocks {
  /** Upserts daily price snapshot per nmId. */
  async upsertDailyPrices(rows: DailyPricesRow[]): Promise<void> {
    if (rows.length === 0) return;
    const tbl = this.tableName("wb_product_daily_prices");

    const values: unknown[] = [];
    const placeholders = rows.map((r, i) => {
      const b = i * 4;
      values.push(r.nmId, r.priceDate, r.price, r.discount);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, NOW())`;
    });

    await this.getPool().query(
      `INSERT INTO ${tbl} (nm_id, price_date, price, discount, updated_at)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (nm_id, price_date) DO UPDATE SET
         price      = EXCLUDED.price,
         discount   = EXCLUDED.discount,
         updated_at = NOW()`,
      values,
    );
  }

  /** Returns the latest (most recent) price per nmId. */
  async getLatestPrices(): Promise<{ nmId: number; price: number; discount: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; price: string; discount: string }>(
      `SELECT DISTINCT ON (nm_id) nm_id::text, price::text, discount::text
       FROM ${this.tableName("wb_product_daily_prices")}
       ORDER BY nm_id ASC, price_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      price: Number(r.price),
      discount: Number(r.discount),
    }));
  }

  /** Returns all price snapshots for all products and dates (newest first). */
  async getPricesMatrix(): Promise<{ nmId: number; priceDate: string; price: number; discount: number }[]> {
    const result = await this.getPool().query<{
      nm_id: string;
      price_date: string;
      price: string;
      discount: string;
    }>(
      `SELECT nm_id::text, TO_CHAR(price_date, 'YYYY-MM-DD') AS price_date, price::text, discount::text
       FROM ${this.tableName("wb_product_daily_prices")}
       ORDER BY nm_id ASC, price_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      priceDate: r.price_date,
      price: Number(r.price),
      discount: Number(r.discount),
    }));
  }

  // ─── Очередь изменений цен (запись на маркетплейс WB) ───────────────────────

  private mapPriceChangeRow(r: {
    nm_id: string;
    desired_base_price: string;
    desired_discount: string;
    desired_final: string;
    sync_status: string;
    upload_id: string | null;
    observed_final: string | null;
    confirmed_at: string | null;
    retry_at: string | null;
    last_error: string | null;
    attempt_count: string;
    updated_at: string;
  }): PriceChangeRow {
    return {
      nmId: Number(r.nm_id),
      desiredBasePrice: Number(r.desired_base_price),
      desiredDiscount: Number(r.desired_discount),
      desiredFinal: Number(r.desired_final),
      syncStatus: r.sync_status as PriceChangeSyncStatus,
      uploadId: r.upload_id === null ? null : Number(r.upload_id),
      observedFinal: r.observed_final === null ? null : Number(r.observed_final),
      confirmedAt: r.confirmed_at,
      retryAt: r.retry_at,
      lastError: r.last_error,
      attemptCount: Number(r.attempt_count),
      updatedAt: r.updated_at,
    };
  }

  /** Queues (or re-queues) a user-initiated price change. Resets status/attempts. */
  async upsertPriceChangeQueued(input: {
    nmId: number;
    basePrice: number;
    discount: number;
    finalPrice: number;
  }): Promise<void> {
    await this.getPool().query(
      `INSERT INTO ${this.tableName("wb_product_price_changes")}
         (nm_id, desired_base_price, desired_discount, desired_final,
          sync_status, upload_id, confirmed_at, retry_at, last_error, attempt_count, updated_at)
       VALUES ($1, $2, $3, $4, 'queued', NULL, NULL, NULL, NULL, 0, NOW())
       ON CONFLICT (nm_id) DO UPDATE SET
         desired_base_price = EXCLUDED.desired_base_price,
         desired_discount   = EXCLUDED.desired_discount,
         desired_final      = EXCLUDED.desired_final,
         sync_status        = 'queued',
         upload_id          = NULL,
         confirmed_at       = NULL,
         retry_at           = NULL,
         last_error         = NULL,
         attempt_count      = 0,
         updated_at         = NOW()`,
      [input.nmId, Math.round(input.basePrice), Math.round(input.discount), input.finalPrice],
    );
  }

  /** Patches a price-change row's status fields. Only provided keys are updated. */
  async updatePriceChange(
    nmId: number,
    patch: {
      syncStatus?: PriceChangeSyncStatus;
      uploadId?: number | null;
      observedFinal?: number | null;
      confirmedAt?: string | null;
      retryAt?: string | null;
      lastError?: string | null;
      bumpAttempt?: boolean;
    },
  ): Promise<void> {
    const sets: string[] = ["updated_at = NOW()"];
    const values: unknown[] = [];
    let i = 1;
    if (patch.syncStatus !== undefined) { sets.push(`sync_status = $${i++}`); values.push(patch.syncStatus); }
    if (patch.uploadId !== undefined)   { sets.push(`upload_id = $${i++}`);   values.push(patch.uploadId); }
    if (patch.observedFinal !== undefined){ sets.push(`observed_final = $${i++}`); values.push(patch.observedFinal); }
    if (patch.confirmedAt !== undefined){ sets.push(`confirmed_at = $${i++}`);values.push(patch.confirmedAt); }
    if (patch.retryAt !== undefined)    { sets.push(`retry_at = $${i++}`);    values.push(patch.retryAt); }
    if (patch.lastError !== undefined)  { sets.push(`last_error = $${i++}`);  values.push(patch.lastError); }
    if (patch.bumpAttempt)              { sets.push(`attempt_count = attempt_count + 1`); }
    values.push(nmId);
    await this.getPool().query(
      `UPDATE ${this.tableName("wb_product_price_changes")}
       SET ${sets.join(", ")}
       WHERE nm_id = $${i}`,
      values,
    );
  }

  /** All price-change rows (for the frontend status indicators). */
  async getPriceChangeRows(): Promise<PriceChangeRow[]> {
    const result = await this.getPool().query(
      `SELECT nm_id::text, desired_base_price::text, desired_discount::text,
              desired_final::text, sync_status, upload_id::text, observed_final::text,
              confirmed_at, retry_at, last_error, attempt_count::text, updated_at
       FROM ${this.tableName("wb_product_price_changes")}`,
    );
    return result.rows.map((r) => this.mapPriceChangeRow(r as Parameters<typeof this.mapPriceChangeRow>[0]));
  }

  /** Rows still awaiting WB confirmation (for the reconcile pass). */
  async getActivePriceChanges(): Promise<PriceChangeRow[]> {
    const result = await this.getPool().query(
      `SELECT nm_id::text, desired_base_price::text, desired_discount::text,
              desired_final::text, sync_status, upload_id::text, observed_final::text,
              confirmed_at, retry_at, last_error, attempt_count::text, updated_at
       FROM ${this.tableName("wb_product_price_changes")}
       WHERE sync_status IN ('sending', 'pending', 'throttled')`,
    );
    return result.rows.map((r) => this.mapPriceChangeRow(r as Parameters<typeof this.mapPriceChangeRow>[0]));
  }
}
