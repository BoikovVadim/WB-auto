import type { Client, ClientConfig } from "pg";

import { appEnv } from "../common/env";
import type { MonthlyFrequencyRow } from "./monthly-frequency-analytics.types";
import type { MonthlyFrequencyImportPeriod } from "./monthly-frequency-import.period";

function escapeIdentifier(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function tableName(name: string) {
  return `${escapeIdentifier(appEnv.postgres.schema)}.${escapeIdentifier(name)}`;
}

export function getRequiredMonthlyFrequencyPostgresConfig(): ClientConfig {
  if (!appEnv.postgres.enabled) {
    throw new Error(
      "PostgreSQL is not configured. Set DATABASE_URL or PGHOST/PGUSER/PGDATABASE.",
    );
  }

  if ("connectionString" in appEnv.postgres) {
    return {
      connectionString: appEnv.postgres.connectionString,
      ssl: appEnv.postgres.ssl,
    };
  }

  return {
    host: appEnv.postgres.host,
    port: appEnv.postgres.port,
    user: appEnv.postgres.user,
    password: appEnv.postgres.password,
    database: appEnv.postgres.database,
    ssl: appEnv.postgres.ssl,
  };
}

export async function ensureMonthlyFrequencyTable(client: Client) {
  await client.query(
    `CREATE SCHEMA IF NOT EXISTS ${escapeIdentifier(appEnv.postgres.schema)}`,
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${tableName("wb_search_query_frequencies")} (
      normalized_query_text TEXT PRIMARY KEY,
      query_text TEXT NOT NULL,
      monthly_frequency NUMERIC NOT NULL,
      report_type TEXT NOT NULL,
      report_id TEXT NULL,
      download_id TEXT NULL,
      report_start_date DATE NOT NULL,
      report_end_date DATE NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS wb_search_query_frequencies_report_end_idx
    ON ${tableName("wb_search_query_frequencies")} (report_end_date DESC, synced_at DESC)
  `);
}

export async function replaceMonthlyFrequencySnapshot(
  client: Client,
  input: {
    rows: MonthlyFrequencyRow[];
    reportType: string;
    reportId: string;
    downloadId: string;
    period: MonthlyFrequencyImportPeriod;
    normalizeAdvertisingText: (value: string) => string;
  },
) {
  const deduplicatedRows = new Map<string, MonthlyFrequencyRow>();
  for (const row of input.rows) {
    const normalizedQueryText = input.normalizeAdvertisingText(row.queryText);
    const existing = deduplicatedRows.get(normalizedQueryText);
    if (!existing || row.monthlyFrequency > existing.monthlyFrequency) {
      deduplicatedRows.set(normalizedQueryText, row);
    }
  }

  await client.query("BEGIN");
  try {
    await client.query(`DELETE FROM ${tableName("wb_search_query_frequencies")}`);

    for (const [normalizedQueryText, row] of deduplicatedRows) {
      await client.query(
        `
          INSERT INTO ${tableName("wb_search_query_frequencies")} (
            normalized_query_text,
            query_text,
            monthly_frequency,
            report_type,
            report_id,
            download_id,
            report_start_date,
            report_end_date,
            synced_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,NOW())
        `,
        [
          normalizedQueryText,
          row.queryText,
          row.monthlyFrequency,
          input.reportType,
          input.reportId,
          input.downloadId,
          input.period.from,
          input.period.to,
        ],
      );
    }

    await client.query("COMMIT");
    return deduplicatedRows.size;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function loadMonthlyFrequencySnapshotSample(
  client: Client,
  limit: number,
) {
  const result = await client.query<{
    query_text: string;
    monthly_frequency: string;
    report_start_date: string;
    report_end_date: string;
    synced_at: string;
  }>(
    `
      SELECT
        query_text,
        monthly_frequency::text AS monthly_frequency,
        report_start_date::text AS report_start_date,
        report_end_date::text AS report_end_date,
        synced_at::text AS synced_at
      FROM ${tableName("wb_search_query_frequencies")}
      ORDER BY monthly_frequency DESC, query_text ASC
      LIMIT $1
    `,
    [limit],
  );

  return result.rows.map((row) => ({
    queryText: row.query_text,
    monthlyFrequency: Number(row.monthly_frequency),
    reportStartDate: row.report_start_date,
    reportEndDate: row.report_end_date,
    syncedAt: row.synced_at,
  }));
}

export async function countMonthlyFrequencySnapshotRows(client: Client) {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${tableName("wb_search_query_frequencies")}`,
  );
  return Number(result.rows[0]?.count ?? "0");
}
