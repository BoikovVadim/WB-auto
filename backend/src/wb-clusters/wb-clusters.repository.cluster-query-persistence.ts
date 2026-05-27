import { WbClustersRepositoryClusterStatsPersistence } from "./wb-clusters.repository.cluster-stats-persistence";
export abstract class WbClustersRepositoryClusterQueryPersistence extends WbClustersRepositoryClusterStatsPersistence {
  async replaceClusterQueries(input: {
    advertId: number;
    nmId: number;
    rows: Array<{
      clusterName: string;
      queryText: string;
    }>;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM ${this.tableName("wb_cluster_queries")} WHERE advert_id = $1 AND nm_id = $2`,
        [input.advertId, input.nmId],
      );

      const seenRows = new Set<string>();

      for (const row of input.rows) {
        const normalizedClusterName = this.normalizeQuery(row.clusterName);
        const normalizedQueryText = this.normalizeQuery(row.queryText);
        const rowKey = `${normalizedClusterName}:${normalizedQueryText}`;
        if (seenRows.has(rowKey)) {
          continue;
        }
        seenRows.add(rowKey);

        const clusterQueryKey = this.buildScopedTextKey(
          input.advertId,
          input.nmId,
          `${normalizedClusterName}:${normalizedQueryText}`,
        );
        await client.query(
          `
            INSERT INTO ${this.tableName("wb_cluster_queries")} (
              cluster_query_key,
              advert_id,
              nm_id,
              cluster_name,
              normalized_cluster_name,
              query_text,
              normalized_query_text,
              synced_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
            ON CONFLICT (cluster_query_key) DO UPDATE
            SET
              cluster_name = EXCLUDED.cluster_name,
              normalized_cluster_name = EXCLUDED.normalized_cluster_name,
              query_text = EXCLUDED.query_text,
              normalized_query_text = EXCLUDED.normalized_query_text,
              synced_at = NOW()
          `,
          [
            clusterQueryKey,
            input.advertId,
            input.nmId,
            row.clusterName,
            normalizedClusterName,
            row.queryText,
            normalizedQueryText,
          ],
        );
      }

      await client.query("COMMIT");
      return seenRows.size;
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async replaceCabinetClusterQueries(input: {
    advertId: number;
    nmId: number;
    captureMode: string;
    sourceEndpoint: string | null;
    capturedAt: string;
    clearExisting?: boolean;
    rows: Array<{
      clusterName: string;
      queryText: string;
    }>;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      if (input.clearExisting ?? true) {
        await client.query(
          `DELETE FROM ${this.tableName("wb_cabinet_cluster_queries")} WHERE advert_id = $1 AND nm_id = $2`,
          [input.advertId, input.nmId],
        );
      }

      const seenRows = new Set<string>();

      for (const row of input.rows) {
        const normalizedClusterName = this.normalizeQuery(row.clusterName);
        const normalizedQueryText = this.normalizeQuery(row.queryText);
        // Punctuation-stripped identity used to match wb_search_query_frequencies,
        // whose normalized_query_identity column is written with the same algorithm.
        // normalizeQuery keeps punctuation, so it never matched the frequency report
        // (e.g. "чехол s24+" vs "чехол s24"); identity matching fixes that.
        const normalizedQueryIdentity = this.normalizeAdvertisingIdentity(row.queryText);
        const rowKey = `${normalizedClusterName}:${normalizedQueryText}`;
        if (seenRows.has(rowKey)) {
          continue;
        }
        seenRows.add(rowKey);

        const cabinetQueryKey = this.buildScopedTextKey(
          input.advertId,
          input.nmId,
          `cabinet:${normalizedClusterName}:${normalizedQueryText}`,
        );
        await client.query(
          `
            INSERT INTO ${this.tableName("wb_cabinet_cluster_queries")} (
              cabinet_query_key,
              advert_id,
              nm_id,
              cluster_name,
              normalized_cluster_name,
              query_text,
              normalized_query_text,
              normalized_query_identity,
              capture_mode,
              source_endpoint,
              captured_at,
              synced_at,
              monthly_frequency
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,NOW(),
              (SELECT monthly_frequency FROM ${this.tableName("wb_search_query_frequencies")}
               WHERE normalized_query_identity = $8 LIMIT 1)
            )
            ON CONFLICT (cabinet_query_key) DO UPDATE
            SET
              cluster_name = EXCLUDED.cluster_name,
              normalized_cluster_name = EXCLUDED.normalized_cluster_name,
              query_text = EXCLUDED.query_text,
              normalized_query_text = EXCLUDED.normalized_query_text,
              normalized_query_identity = EXCLUDED.normalized_query_identity,
              capture_mode = EXCLUDED.capture_mode,
              source_endpoint = EXCLUDED.source_endpoint,
              captured_at = EXCLUDED.captured_at,
              synced_at = NOW(),
              monthly_frequency = COALESCE(EXCLUDED.monthly_frequency, ${this.tableName("wb_cabinet_cluster_queries")}.monthly_frequency)
          `,
          [
            cabinetQueryKey,
            input.advertId,
            input.nmId,
            row.clusterName,
            normalizedClusterName,
            row.queryText,
            normalizedQueryText,
            normalizedQueryIdentity,
            input.captureMode,
            input.sourceEndpoint,
            input.capturedAt,
          ],
        );
      }

      await client.query("COMMIT");
      return seenRows.size;
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getCabinetQueryMapImportCandidates(input?: {
    limit?: number;
    mode?: "all" | "missing";
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const limit = Math.max(1, Math.min(input?.limit ?? 100, 1000));
    const mode = input?.mode ?? "missing";
    const missingOnlyClause = mode === "missing" ? "HAVING COUNT(cq.cabinet_query_key) = 0" : "";

    const result = await pool.query<{
      advert_id: string;
      nm_id: string;
      existing_row_count: string;
      last_captured_at: string | null;
    }>(
      `
        SELECT
          cp.advert_id::text AS advert_id,
          cp.nm_id::text AS nm_id,
          COUNT(cq.cabinet_query_key)::text AS existing_row_count,
          MAX(cq.captured_at)::text AS last_captured_at
        FROM ${this.tableName("wb_campaign_products")} cp
        JOIN ${this.tableName("wb_campaigns")} c
          ON c.advert_id = cp.advert_id
        LEFT JOIN ${this.tableName("wb_cabinet_cluster_queries")} cq
          ON cq.advert_id = cp.advert_id
         AND cq.nm_id = cp.nm_id
        GROUP BY cp.advert_id, cp.nm_id, c.campaign_status
        ${missingOnlyClause}
        ORDER BY
          CASE WHEN c.campaign_status IN (9, 11) THEN 0 ELSE 1 END,
          CASE WHEN COUNT(cq.cabinet_query_key) = 0 THEN 0 ELSE 1 END,
          MAX(cq.captured_at) ASC NULLS FIRST,
          cp.advert_id DESC,
          cp.nm_id
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => ({
      advertId: Number(row.advert_id),
      nmId: Number(row.nm_id),
      existingRowCount: Number(row.existing_row_count),
      lastCapturedAt: row.last_captured_at,
    }));
  }

  async replaceMonthlyQueryFrequencies(input: {
    reportType: string;
    reportId: string;
    downloadId: string | null;
    reportStartDate: string;
    reportEndDate: string;
    rows: Array<{
      queryText: string;
      monthlyFrequency: number;
      subjectName?: string | null;
    }>;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM ${this.tableName("wb_search_query_frequencies")}`);

      const deduplicatedRows = new Map<
        string,
        {
          normalizedQueryText: string;
          queryText: string;
          monthlyFrequency: number;
          subjectName: string | null;
          normalizedQueryIdentity: string;
          normalizedQueryStem: string;
        }
      >();

      for (const row of input.rows) {
        const normalizedQueryText = this.normalizeQuery(row.queryText);
        const normalizedQueryIdentity = this.normalizeAdvertisingIdentity(row.queryText);
        const normalizedQueryStem = this.buildAdvertisingStemKey(row.queryText);
        const existing = deduplicatedRows.get(normalizedQueryIdentity);
        if (!existing || row.monthlyFrequency > existing.monthlyFrequency) {
          deduplicatedRows.set(normalizedQueryIdentity, {
            normalizedQueryText,
            queryText: row.queryText,
            monthlyFrequency: row.monthlyFrequency,
            subjectName: row.subjectName ?? null,
            normalizedQueryIdentity,
            normalizedQueryStem,
          });
        }
      }

      for (const row of deduplicatedRows.values()) {
        await client.query(
          `
            INSERT INTO ${this.tableName("wb_search_query_frequencies")} (
              normalized_query_text,
              normalized_query_identity,
              normalized_query_stem,
              query_text,
              monthly_frequency,
              report_type,
              report_id,
              download_id,
              report_start_date,
              report_end_date,
              subject_name,
              synced_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11,NOW())
          `,
          [
            row.normalizedQueryText,
            row.normalizedQueryIdentity,
            row.normalizedQueryStem,
            row.queryText,
            row.monthlyFrequency,
            input.reportType,
            input.reportId,
            input.downloadId,
            input.reportStartDate,
            input.reportEndDate,
            row.subjectName ?? null,
          ],
        );
      }

      await client.query("COMMIT");
      return deduplicatedRows.size;
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

}
