import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { Pool, type PoolClient, type PoolConfig } from "pg";

import { appEnv } from "../common/env";
import { initializeWbClustersSchema } from "./wb-clusters.schema";
import {
  createDefaultProductAdvertisingSnapshotMeta,
} from "./product-advertising-sheet.response";
import type {
  ClusterSourceKind,
  WbClustersSyncRunSummary,
  ProductAdvertisingSheetResponse,
} from "./wb-clusters.types";
import type {
  ClusterSyncRunRecord,
  PreferredProductAdvertisingSnapshotSummaryRecord,
  PreferredProductAdvertisingSnapshotSummaryRow,
  ProductAdvertisingSnapshotSummaryRecord,
  ProductAdvertisingSnapshotSummaryRow,
  ProductPresetSnapshotJobRecord,
  ProductPresetSnapshotJobRecordSummary,
  StoredProductAdvertisingSheetSnapshotRecord,
  StoredProductAdvertisingSheetSnapshotRow,
} from "./wb-clusters.repository.types";

export abstract class WbClustersRepositoryBase {
  protected readonly logger = new Logger("WbClustersRepository");
  private pool: Pool | null = null;
  private schemaReady = false;
  private schemaSetupPromise: Promise<boolean> | null = null;

  isConfigured() {
    return appEnv.postgres.enabled;
  }

  async ensureSchema() {
    if (!this.isConfigured()) {
      return false;
    }

    if (this.schemaReady) {
      return true;
    }

    if (!this.schemaSetupPromise) {
      this.schemaSetupPromise = this.initializeSchema().finally(() => {
        this.schemaSetupPromise = null;
      });
    }

    return this.schemaSetupPromise;
  }

  protected async initializeSchema() {
    const pool = this.getPool();
    await initializeWbClustersSchema({
      pool,
      schema: appEnv.postgres.schema,
      escapeIdentifier: (name) => this.escapeIdentifier(name),
      tableName: (name) => this.tableName(name),
    });
    this.schemaReady = true;
    return true;
  }

  protected mapSyncRun(row: ClusterSyncRunRecord | null): WbClustersSyncRunSummary | null {
    if (!row) {
      return null;
    }

    return {
      syncRunId: row.id,
      status: row.status,
      trigger: row.trigger,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      campaignsSeen: row.campaigns_seen,
      campaignsSynced: row.campaigns_synced,
      productsSeen: row.products_seen,
      clustersUpserted: row.clusters_upserted,
      statsRowsUpserted: row.stats_rows_upserted,
      warningCount: row.warning_count,
      hasPartialFailure: row.has_partial_failure,
      errorMessage: row.error_message,
    };
  }

  protected getPool() {
    if (!this.pool) {
      if (!this.isConfigured()) {
        throw new ServiceUnavailableException(
          "PostgreSQL ?? ???????? ??? official WB clusters.",
        );
      }

      this.pool = new Pool(this.getPoolConfig());
      this.pool.on("connect", (client) => {
        // statement_timeout terminates runaway queries before they starve the pool.
        // idle_in_transaction_session_timeout is intentionally kept high (10 min)
        // to avoid killing legitimate backfill transactions that pause between
        // query steps; it only targets truly abandoned sessions.
        void client
          .query(
            "SET idle_in_transaction_session_timeout = 600000; SET statement_timeout = 300000",
          )
          .catch((err: Error) => {
            this.logger.warn(`Failed to set session timeouts: ${err.message}`);
          });
      });
      this.pool.on("error", (error: Error) => {
        this.logger.error(`PostgreSQL pool error: ${error.message}`);
      });
    }

    return this.pool;
  }

  protected getPoolConfig(): PoolConfig {
    if (!appEnv.postgres.enabled) {
      throw new ServiceUnavailableException(
        "PostgreSQL ?? ???????? ??? official WB clusters.",
      );
    }

    const sharedOptions: Partial<PoolConfig> = {
      // 40 connections: sync phases + параллельные HTTP read-handlers (Promise.all по
      // кампаниям/матрицам) + warmup-воркеры. Подняли с 25 — под нагрузкой пул вставал в
      // очередь (connectionTimeout 10с → 503). На проде max_connections=100 и базовая
      // утилизация ~16, так что 40 + другие приложения остаются с большим запасом.
      max: 40,
      // Release idle connections after 30 s to avoid holding server slots.
      idleTimeoutMillis: 30_000,
      // Fail fast if the pool is saturated; caller surfaces 503 to the user.
      connectionTimeoutMillis: 10_000,
    };

    if ("connectionString" in appEnv.postgres) {
      return {
        ...sharedOptions,
        connectionString: appEnv.postgres.connectionString,
        ssl: appEnv.postgres.ssl ? { rejectUnauthorized: false } : false,
      };
    }

    return {
      ...sharedOptions,
      host: appEnv.postgres.host,
      port: appEnv.postgres.port,
      user: appEnv.postgres.user,
      password: appEnv.postgres.password,
      database: appEnv.postgres.database,
      ssl: appEnv.postgres.ssl ? { rejectUnauthorized: false } : false,
    };
  }

  protected async ensureSchemaOrThrow() {
    const ready = await this.ensureSchema();

    if (!ready) {
      throw new ServiceUnavailableException(
        "PostgreSQL ?? ???????? ??? official WB clusters.",
      );
    }
  }

  protected tableName(name: string) {
    return `${this.escapeIdentifier(appEnv.postgres.schema)}.${this.escapeIdentifier(name)}`;
  }

  protected escapeIdentifier(value: string) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }

  protected buildClusterKey(
    nmId: number,
    clusterName: string,
    sourceKind: ClusterSourceKind,
    advertId?: number | null,
  ) {
    // Keep punctuation (normalizeQuery), matching the normalized_cluster_name column
    // and every JOIN/dedup. See getClusterKeyMigrationStatements for the one-time
    // rebuild of pre-existing keys that used the punctuation-stripping normalizer.
    const normalized = this.normalizeQuery(clusterName);
    // Stats clusters are product-scoped (shared across campaigns).
    // Active/excluded clusters are campaign-scoped to prevent cross-campaign key collisions
    // when multiple campaigns for the same product share cluster names.
    if (sourceKind === "stats" || advertId == null) {
      return `${nmId}:${sourceKind}:${normalized}`;
    }
    return `${nmId}:${advertId}:${sourceKind}:${normalized}`;
  }

  protected buildScopedTextKey(advertId: number, nmId: number, text: string) {
    return `${advertId}:${nmId}:${this.normalizeAdvertisingIdentity(text)}`;
  }

  protected buildDatedScopedTextKey(
    advertId: number,
    nmId: number,
    isoDate: string,
    text: string,
  ) {
    return `${advertId}:${nmId}:${isoDate}:${this.normalizeAdvertisingIdentity(text)}`;
  }

  protected buildDatedTextKey(advertId: number, isoDate: string, text: string) {
    return `${advertId}:${isoDate}:${this.normalizeAdvertisingIdentity(text)}`;
  }

  protected buildProductSearchTextRangeSnapshotKey(
    nmId: number,
    startDate: string,
    endDate: string,
  ) {
    return `${nmId}:${startDate}:${endDate}`;
  }

  protected buildProductAdvertisingSheetSnapshotStorageKey(
    nmId: number,
    startDate: string,
    endDate: string,
    schemaVersion: number,
  ) {
    return `${nmId}:${startDate}:${endDate}:v${schemaVersion}`;
  }

  protected buildProductWorkspaceSnapshotStorageKey(
    nmId: number,
    startDate: string,
    endDate: string,
    schemaVersion: number,
  ) {
    return `${this.buildProductAdvertisingSheetSnapshotStorageKey(
      nmId,
      startDate,
      endDate,
      schemaVersion,
    )}:workspace`;
  }

  protected buildProductWorkspaceCampaignRowsStorageKey(
    nmId: number,
    startDate: string,
    endDate: string,
    schemaVersion: number,
    advertId: number,
  ) {
    return `${this.buildProductWorkspaceSnapshotStorageKey(
      nmId,
      startDate,
      endDate,
      schemaVersion,
    )}:campaign:${String(advertId)}`;
  }

  protected buildProductWorkspaceClusterQueriesStorageKey(
    nmId: number,
    startDate: string,
    endDate: string,
    schemaVersion: number,
    advertId: number,
    clusterKey: string,
  ) {
    return `${this.buildProductWorkspaceCampaignRowsStorageKey(
      nmId,
      startDate,
      endDate,
      schemaVersion,
      advertId,
    )}:cluster:${clusterKey}`;
  }

  protected normalizeQuery(value: string) {
    return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
  }

  protected normalizeAdvertisingIdentity(value: string) {
    return value
      .trim()
      .toLocaleLowerCase("ru")
      .replace(/[_/\\|.,:;!?()[\]{}"'+=*%#№@`~^&-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  protected normalizedQueryIdentitySql(expression: string) {
    return `TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(${expression}), '[^0-9a-zа-яё]+', ' ', 'g'), '\\s+', ' ', 'g'))`;
  }

  protected normalizedQueryStemSql(expression: string) {
    return `TRIM(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          ${this.normalizedQueryIdentitySql(expression)},
          '(иями|ями|ами|ого|ему|ому|ыми|ими|его|ая|яя|ое|ее|ой|ий|ый|ые|ие|их|ых|ую|юю|ам|ям|ах|ях|ом|ем|ов|ев|ей|а|я|ы|и|у|ю|о|е|ь|й)\\y',
          '',
          'gi'
        ),
        '\\s+',
        ' ',
        'g'
      )
    )`;
  }

  protected buildFrequencyJoinCondition(
    frequencyAlias: string,
    normalizedQueryExpression: string,
  ) {
    // Identity-based JOIN (punctuation-stripped). Must stay symmetric with the
    // cluster-row aggregator in advertising-sheet-core-query-loader.ts, which
    // sums frequencies by normalized_query_identity. Using exact text match
    // here while the aggregator uses identity caused per-query rows to show "-"
    // for queries whose WB report variant differed only by punctuation
    // (e.g. "клетка-для-собак" vs "клетка для собак"), while the cluster total
    // still included those frequencies — making the cluster row larger than
    // the sum of its visible children. wb_search_query_frequencies is
    // import-deduped by identity (one row per identity), so this join never
    // multiplies rows.
    return `${frequencyAlias}.normalized_query_identity = ${this.normalizedQueryIdentitySql(normalizedQueryExpression)}`;
  }

  protected buildAdvertisingStemKey(value: string) {
    const normalizedIdentity = this.normalizeAdvertisingIdentity(value);
    return normalizedIdentity
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .map((token) => this.stemAdvertisingTokenForIdentity(token))
      .join(" ");
  }

  protected stemAdvertisingTokenForIdentity(token: string) {
    const normalizedToken = token.trim();
    if (normalizedToken.length <= 3) {
      return normalizedToken;
    }

    const suffixes = [
      "иями",
      "ями",
      "ами",
      "ого",
      "ему",
      "ому",
      "ыми",
      "ими",
      "его",
      "ая",
      "яя",
      "ое",
      "ее",
      "ой",
      "ий",
      "ый",
      "ые",
      "ие",
      "их",
      "ых",
      "ую",
      "юю",
      "ам",
      "ям",
      "ах",
      "ях",
      "ом",
      "ем",
      "ов",
      "ев",
      "ей",
      "а",
      "я",
      "ы",
      "и",
      "у",
      "ю",
      "о",
      "е",
      "ь",
      "й",
    ];

    for (const suffix of suffixes) {
      if (
        normalizedToken.length > suffix.length + 2 &&
        normalizedToken.endsWith(suffix)
      ) {
        return normalizedToken.slice(0, -suffix.length);
      }
    }

    return normalizedToken;
  }

  protected toNullableNumber(value: string | null) {
    if (value === null) {
      return null;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  protected createEmptyProductAdvertisingSheet(
    nmId: number,
  ): ProductAdvertisingSheetResponse {
    return {
      nmId,
      checkedAt: new Date().toISOString(),
      snapshot: createDefaultProductAdvertisingSnapshotMeta(),
      range: {
        startDate: null,
        endDate: null,
        jamIncluded: false,
        jamStatus: "not_requested",
      },
      summary: {
        campaignsCount: 0,
        clustersCount: 0,
        clusterQueriesCount: 0,
        dailyStatsCount: 0,
        minusPhrasesCount: 0,
        keywordStatsCount: 0,
        queryCoverageStatus: "no-clusters",
        queryCoverageReason: null,
        dailyStatsCoverageStatus: "not_requested",
        dailyStatsCoverageReason: null,
        dailyStatsWindowStartDate: null,
        dailyStatsWindowEndDate: null,
        periodMetricsStatus: "unavailable",
        periodMetricsReason: null,
        periodMetricsActualStartDate: null,
        periodMetricsActualEndDate: null,
      },
      campaigns: [],
      clusters: [],
      clusterQueries: [],
      dailyStats: [],
      minusPhrases: [],
      keywordStats: [],
    };
  }

  protected mapStoredProductAdvertisingSheetSnapshotRow(
    row: StoredProductAdvertisingSheetSnapshotRow | undefined,
  ): StoredProductAdvertisingSheetSnapshotRecord | null {
    if (!row) {
      return null;
    }

    return {
      nmId: Number(row.nm_id ?? 0),
      payload: row.payload,
      startDate: row.start_date,
      endDate: row.end_date,
      schemaVersion: row.schema_version,
      status: row.status,
      builtFromExportRequestId: row.built_from_export_request_id,
      sourceKind: row.source_kind,
      readyAt: row.ready_at,
      lastAttemptAt: row.last_attempt_at,
      failureReason: row.failure_reason,
      syncedAt: row.synced_at,
    };
  }

  protected mapProductAdvertisingSnapshotSummaryRow(
    row: ProductAdvertisingSnapshotSummaryRow | undefined,
  ): ProductAdvertisingSnapshotSummaryRecord | null {
    if (!row) {
      return null;
    }

    return {
      nmId: Number(row.nm_id),
      startDate: row.start_date,
      endDate: row.end_date,
      schemaVersion: row.schema_version,
      status: row.status,
      builtFromExportRequestId: row.built_from_export_request_id,
      readyAt: row.ready_at,
      failureReason: row.failure_reason,
      syncedAt: row.synced_at,
    };
  }

  protected mapPreferredProductAdvertisingSnapshotSummaryRow(
    row: PreferredProductAdvertisingSnapshotSummaryRow | undefined,
  ): PreferredProductAdvertisingSnapshotSummaryRecord | null {
    if (!row) {
      return null;
    }

    const mappedRow = this.mapProductAdvertisingSnapshotSummaryRow(row);
    if (!mappedRow) {
      return null;
    }

    return {
      ...mappedRow,
      fit: row.resolution_fit,
      source: row.resolution_source,
    };
  }

  protected mapProductPresetSnapshotJobRow(
    row: ProductPresetSnapshotJobRecord | null,
  ): ProductPresetSnapshotJobRecordSummary | null {
    if (!row) {
      return null;
    }

    return {
      jobId: row.job_id,
      sourceExportRequestId: row.source_export_request_id,
      presetExportRequestId: row.preset_export_request_id,
      startDate: row.requested_start_date,
      endDate: row.requested_end_date,
      status: row.status,
      attemptCount: row.attempt_count,
      nextAttemptAt: row.next_attempt_at,
      lastAttemptAt: row.last_attempt_at,
      lastError: row.last_error,
      reason: row.reason,
      nmIds: row.nm_ids_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected async rollbackQuietly(client: PoolClient) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failures: the original error is more useful.
    }
  }
}
