import { randomUUID } from "node:crypto";

import type { SearchQueryTextView } from "../wb-sync/wb-sync.types";
import type {
  StoredProductSearchTextRangeRecord,
  StoredProductSearchTextRangeRow,
  StoredProductSearchTextRangeSnapshotRow,
} from "./wb-clusters.repository.types";
import { WbClustersRepositorySnapshotSummaries } from "./wb-clusters.repository.snapshot-summaries";
export abstract class WbClustersRepositorySearchTextStorage extends WbClustersRepositorySnapshotSummaries {
  async saveRawArchive(input: {
    syncRunId: string;
    archiveType: string;
    advertId: number | null;
    nmId: number | null;
    payload: unknown;
  }) {
    await this.saveRawArchives([input]);
  }

  async replaceStoredProductSearchTextRange(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    rows: SearchQueryTextView[];
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();
    const snapshotKey = this.buildProductSearchTextRangeSnapshotKey(
      input.nmId,
      input.startDate,
      input.endDate,
    );

    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO ${this.tableName("wb_product_search_text_range_snapshots")} (
            snapshot_key,
            nm_id,
            start_date,
            end_date,
            row_count,
            synced_at
          ) VALUES ($1, $2, $3::date, $4::date, $5, NOW())
          ON CONFLICT (nm_id, start_date, end_date)
          DO UPDATE SET
            snapshot_key = EXCLUDED.snapshot_key,
            row_count = EXCLUDED.row_count,
            synced_at = NOW()
        `,
        [snapshotKey, input.nmId, input.startDate, input.endDate, input.rows.length],
      );

      await client.query(
        `
          DELETE FROM ${this.tableName("wb_product_search_text_range_rows")}
          WHERE snapshot_key = $1
        `,
        [snapshotKey],
      );

      for (const row of input.rows) {
        const normalizedQueryText = this.normalizeQuery(row.text);
        await client.query(
          `
            INSERT INTO ${this.tableName("wb_product_search_text_range_rows")} (
              row_key,
              snapshot_key,
              query_text,
              normalized_query_text,
              frequency,
              week_frequency,
              avg_position_current,
              avg_position_dynamics,
              orders_current,
              orders_dynamics,
              open_card_current,
              open_card_dynamics,
              add_to_cart_current,
              add_to_cart_dynamics,
              open_to_cart_current,
              open_to_cart_dynamics,
              synced_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW()
            )
          `,
          [
            `${snapshotKey}:${normalizedQueryText}`,
            snapshotKey,
            row.text,
            normalizedQueryText,
            row.frequency,
            row.weekFrequency,
            row.avgPosition.current,
            row.avgPosition.dynamics,
            row.orders.current,
            row.orders.dynamics,
            row.openCard.current,
            row.openCard.dynamics,
            row.addToCart.current,
            row.addToCart.dynamics,
            row.openToCart.current,
            row.openToCart.dynamics,
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

  async getStoredProductSearchTextRange(input: {
    nmId: number;
    startDate: string;
    endDate: string;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    // 1. Try exact match first (fastest path, covers live-fetched multi-day snapshots)
    const snapshotResult = await pool.query<StoredProductSearchTextRangeSnapshotRow>(
      `
        SELECT snapshot_key, row_count, synced_at
        FROM ${this.tableName("wb_product_search_text_range_snapshots")}
        WHERE nm_id = $1
          AND start_date = $2::date
          AND end_date = $3::date
        LIMIT 1
      `,
      [input.nmId, input.startDate, input.endDate],
    );

    const snapshot = snapshotResult.rows[0] ?? null;
    if (snapshot) {
      if (snapshot.row_count === 0) {
        return [] as StoredProductSearchTextRangeRecord;
      }

      const rowsResult = await pool.query<StoredProductSearchTextRangeRow>(
        `
          SELECT
            query_text,
            frequency::text AS frequency,
            week_frequency::text AS week_frequency,
            avg_position_current::text AS avg_position_current,
            avg_position_dynamics::text AS avg_position_dynamics,
            orders_current::text AS orders_current,
            orders_dynamics::text AS orders_dynamics,
            open_card_current::text AS open_card_current,
            open_card_dynamics::text AS open_card_dynamics,
            add_to_cart_current::text AS add_to_cart_current,
            add_to_cart_dynamics::text AS add_to_cart_dynamics,
            open_to_cart_current::text AS open_to_cart_current,
            open_to_cart_dynamics::text AS open_to_cart_dynamics
          FROM ${this.tableName("wb_product_search_text_range_rows")}
          WHERE snapshot_key = $1
          ORDER BY open_card_current DESC NULLS LAST, frequency DESC NULLS LAST, query_text ASC
        `,
        [snapshot.snapshot_key],
      );

      return rowsResult.rows.map((row) => ({
        text: row.query_text,
        frequency: this.toNullableNumber(row.frequency),
        weekFrequency: this.toNullableNumber(row.week_frequency),
        wbCluster: null,
        avgPosition: {
          current: this.toNullableNumber(row.avg_position_current),
          dynamics: this.toNullableNumber(row.avg_position_dynamics),
        },
        orders: {
          current: this.toNullableNumber(row.orders_current),
          dynamics: this.toNullableNumber(row.orders_dynamics),
        },
        openCard: {
          current: this.toNullableNumber(row.open_card_current),
          dynamics: this.toNullableNumber(row.open_card_dynamics),
        },
        addToCart: {
          current: this.toNullableNumber(row.add_to_cart_current),
          dynamics: this.toNullableNumber(row.add_to_cart_dynamics),
        },
        openToCart: {
          current: this.toNullableNumber(row.open_to_cart_current),
          dynamics: this.toNullableNumber(row.open_to_cart_dynamics),
        },
      }));
    }

    // 2. For single-day with no exact match: return null so caller triggers a live fetch
    //    which will be stored as a 1-day snapshot for future instant reads.
    if (input.startDate === input.endDate) {
      return null as StoredProductSearchTextRangeRecord;
    }

    // 3. For multi-day ranges: aggregate from per-day snapshots stored in DB.
    //    This is the primary read path once the daily backfill has run.
    //    frequency/orders/openCard are additive (daily counts). Position uses a
    //    click-weighted average. Dynamics are nulled (not meaningful across days).
    return this.getAggregatedDailyProductSearchTextRange(input);
  }

  private async getAggregatedDailyProductSearchTextRange(input: {
    nmId: number;
    startDate: string;
    endDate: string;
  }): Promise<StoredProductSearchTextRangeRecord> {
    const pool = this.getPool();

    const result = await pool.query<{
      query_text: string;
      frequency: string | null;
      orders_current: string | null;
      open_card_current: string | null;
      add_to_cart_current: string | null;
      open_to_cart_current: string | null;
      avg_position_current: string | null;
    }>(
      `
        SELECT
          MAX(r.query_text)                                              AS query_text,
          SUM(r.frequency)::text                                         AS frequency,
          SUM(r.orders_current)::text                                    AS orders_current,
          SUM(r.open_card_current)::text                                 AS open_card_current,
          SUM(r.add_to_cart_current)::text                               AS add_to_cart_current,
          SUM(r.open_to_cart_current)::text                              AS open_to_cart_current,
          (CASE
            WHEN SUM(r.open_card_current) > 0
              THEN SUM(r.avg_position_current * r.open_card_current) / SUM(r.open_card_current)
            ELSE AVG(r.avg_position_current)
          END)::text                                                     AS avg_position_current
        FROM ${this.tableName("wb_product_search_text_range_snapshots")} s
        JOIN ${this.tableName("wb_product_search_text_range_rows")} r
          ON r.snapshot_key = s.snapshot_key
        WHERE s.nm_id      = $1
          AND s.start_date >= $2::date
          AND s.end_date   <= $3::date
          AND s.start_date  = s.end_date
        GROUP BY r.normalized_query_text
        ORDER BY SUM(r.open_card_current) DESC NULLS LAST,
                 SUM(r.frequency)         DESC NULLS LAST,
                 MAX(r.query_text)        ASC
        LIMIT 1000
      `,
      [input.nmId, input.startDate, input.endDate],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows.map((row) => ({
      text: row.query_text,
      frequency: this.toNullableNumber(row.frequency),
      weekFrequency: null,
      wbCluster: null,
      avgPosition: {
        current: this.toNullableNumber(row.avg_position_current),
        dynamics: null,
      },
      orders:    { current: this.toNullableNumber(row.orders_current),    dynamics: null },
      openCard:  { current: this.toNullableNumber(row.open_card_current), dynamics: null },
      addToCart: { current: this.toNullableNumber(row.add_to_cart_current), dynamics: null },
      openToCart:{ current: this.toNullableNumber(row.open_to_cart_current), dynamics: null },
    }));
  }

  /**
   * Returns true if a JAM API attempt for (nmId, date) was recorded within the
   * last 65 minutes (WB's rate-limit cooldown window).
   */
  async wasJamAttemptedRecently(nmId: number, date: string): Promise<boolean> {
    const pool = this.getPool();
    const result = await pool.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM ${this.tableName("wb_jam_attempt_log")}
          WHERE nm_id = $1
            AND date  = $2::date
            AND last_attempted_at > NOW() - INTERVAL '65 minutes'
        ) AS exists
      `,
      [nmId, date],
    );
    return result.rows[0]?.exists ?? false;
  }

  /**
   * Records that a JAM API attempt was made for this (nmId, date) combination.
   * Upserts so only the most recent attempt timestamp is retained.
   * Call this for EVERY attempt — successful or rate-limited — so that
   * findMissingDailyJamDates can skip recently-touched combinations and avoid
   * extending WB's 1-hour rate-limit cooldown.
   */
  async logJamAttempt(nmId: number, date: string): Promise<void> {
    const pool = this.getPool();
    await pool.query(
      `
        INSERT INTO ${this.tableName("wb_jam_attempt_log")} (nm_id, date, last_attempted_at)
        VALUES ($1, $2::date, NOW())
        ON CONFLICT (nm_id, date) DO UPDATE SET last_attempted_at = NOW()
      `,
      [nmId, date],
    );
  }

  /**
   * Returns all calendar days in [today - lookbackDays .. yesterday] that do NOT
   * yet have a per-day JAM snapshot for this nmId AND were not attempted in the
   * last 65 minutes.  Used by the sync phase to drive incremental backfill.
   *
   * Skipping recently-attempted dates is critical: every WB API call (even a
   * rate-limited one) resets WB's 1-hour cooldown timer for that combination.
   * Without this guard, repeated backfill triggers create an endless cycle where
   * no new data is ever saved.
   */
  async findMissingDailyJamDates(input: {
    nmId: number;
    lookbackDays: number;
    maxPerProduct?: number;
  }): Promise<string[]> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    const startDate = new Date(Date.now() - input.lookbackDays * 24 * 60 * 60 * 1000);
    const startDateStr = startDate.toISOString().slice(0, 10);

    const result = await pool.query<{ missing_date: string }>(
      `
        SELECT TO_CHAR(gs.day, 'YYYY-MM-DD') AS missing_date
        FROM generate_series(
          $2::date,
          CURRENT_DATE - INTERVAL '1 day',
          INTERVAL '1 day'
        ) AS gs(day)
        WHERE NOT EXISTS (
          SELECT 1
          FROM ${this.tableName("wb_product_search_text_range_snapshots")} s
          WHERE s.nm_id      = $1
            AND s.start_date = gs.day::date
            AND s.end_date   = gs.day::date
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ${this.tableName("wb_jam_attempt_log")} al
          WHERE al.nm_id = $1
            AND al.date  = gs.day::date
            AND al.last_attempted_at > NOW() - INTERVAL '65 minutes'
        )
        ORDER BY gs.day DESC
        LIMIT $3
      `,
      [input.nmId, startDateStr, input.maxPerProduct ?? 30],
    );

    return result.rows.map((r) => r.missing_date);
  }

  /**
   * Deletes per-day JAM snapshots and attempt-log entries that are older than
   * `keepDays` calendar days (default: 35 — 5-day buffer above the 30-day lookback).
   * Rows in wb_product_search_text_range_rows are cascade-deleted by FK.
   * Returns the number of snapshots deleted.
   */
  async pruneOldJamData(keepDays = 35): Promise<{ snapshotsDeleted: number; attemptsDeleted: number }> {
    if (!this.isConfigured()) {
      return { snapshotsDeleted: 0, attemptsDeleted: 0 };
    }
    const pool = this.getPool();
    const cutoff = `NOW() - INTERVAL '${keepDays} days'`;

    const snapshotResult = await pool.query<{ count: string }>(
      `
        WITH deleted AS (
          DELETE FROM ${this.tableName("wb_product_search_text_range_snapshots")}
          WHERE end_date < (${cutoff})::date
          RETURNING 1
        )
        SELECT COUNT(*)::text AS count FROM deleted
      `,
    );

    const attemptResult = await pool.query<{ count: string }>(
      `
        WITH deleted AS (
          DELETE FROM ${this.tableName("wb_jam_attempt_log")}
          WHERE last_attempted_at < ${cutoff}
          RETURNING 1
        )
        SELECT COUNT(*)::text AS count FROM deleted
      `,
    );

    return {
      snapshotsDeleted: Number(snapshotResult.rows[0]?.count ?? 0),
      attemptsDeleted: Number(attemptResult.rows[0]?.count ?? 0),
    };
  }

  async deleteStoredProductSearchTextRangesForNmIds(nmIds: number[]) {
    if (nmIds.length === 0) {
      return;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    await pool.query(
      `
        DELETE FROM ${this.tableName("wb_product_search_text_range_snapshots")}
        WHERE nm_id = ANY($1::bigint[])
      `,
      [nmIds],
    );
  }

  async saveRawArchives(
    inputs: Array<{
      syncRunId: string;
      archiveType: string;
      advertId: number | null;
      nmId: number | null;
      payload: unknown;
    }>,
  ) {
    if (inputs.length === 0) {
      return;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    await pool.query(
      `
        INSERT INTO ${this.tableName("wb_cluster_raw_archive")} (
          id,
          sync_run_id,
          archive_type,
          advert_id,
          nm_id,
          payload
        )
        SELECT
          id,
          sync_run_id,
          archive_type,
          advert_id,
          nm_id,
          payload_json::jsonb
        FROM UNNEST(
          $1::text[],
          $2::text[],
          $3::text[],
          $4::bigint[],
          $5::bigint[],
          $6::text[]
        ) AS rows(
          id,
          sync_run_id,
          archive_type,
          advert_id,
          nm_id,
          payload_json
        )
      `,
      [
        inputs.map(() => randomUUID()),
        inputs.map((input) => input.syncRunId),
        inputs.map((input) => input.archiveType),
        inputs.map((input) => input.advertId),
        inputs.map((input) => input.nmId),
        inputs.map((input) => JSON.stringify(input.payload)),
      ],
    );
  }

}
