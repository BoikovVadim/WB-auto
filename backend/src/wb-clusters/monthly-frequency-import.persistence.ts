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

function normalizeAdvertisingIdentity(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/[_/\\|.,:;!?()[\]{}"'+=*%#№@`~^&-]+/g, " ")
    .replace(/\s+/g, " ");
}

function stemToken(token: string) {
  if (token.length <= 3) {
    return token;
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
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
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
      normalized_query_identity TEXT NOT NULL,
      normalized_query_stem TEXT NOT NULL,
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
    ALTER TABLE ${tableName("wb_search_query_frequencies")}
    ADD COLUMN IF NOT EXISTS normalized_query_identity TEXT NULL
  `);
  await client.query(`
    UPDATE ${tableName("wb_search_query_frequencies")}
    SET normalized_query_identity = normalized_query_text
    WHERE normalized_query_identity IS NULL
  `);
  await client.query(`
    ALTER TABLE ${tableName("wb_search_query_frequencies")}
    ALTER COLUMN normalized_query_identity SET NOT NULL
  `);
  await client.query(`
    ALTER TABLE ${tableName("wb_search_query_frequencies")}
    ADD COLUMN IF NOT EXISTS normalized_query_stem TEXT NULL
  `);
  await client.query(`
    UPDATE ${tableName("wb_search_query_frequencies")}
    SET normalized_query_stem = TRIM(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          COALESCE(normalized_query_identity, normalized_query_text),
          '(иями|ями|ами|ого|ему|ому|ыми|ими|его|ая|яя|ое|ее|ой|ий|ый|ые|ие|их|ых|ую|юю|ам|ям|ах|ях|ом|ем|ов|ев|ей|а|я|ы|и|у|ю|о|е|ь|й)\\y',
          '',
          'gi'
        ),
        '\\s+',
        ' ',
        'g'
      )
    )
    WHERE normalized_query_stem IS NULL
  `);
  await client.query(`
    ALTER TABLE ${tableName("wb_search_query_frequencies")}
    ALTER COLUMN normalized_query_stem SET NOT NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS wb_search_query_frequencies_report_end_idx
    ON ${tableName("wb_search_query_frequencies")} (report_end_date DESC, synced_at DESC)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${tableName("wb_query_frequency_history")} (
      id BIGSERIAL PRIMARY KEY,
      normalized_query_text TEXT NOT NULL,
      query_text TEXT NOT NULL,
      monthly_frequency NUMERIC NOT NULL,
      report_start_date DATE NOT NULL,
      report_end_date DATE NOT NULL,
      snapshotted_week DATE NOT NULL,
      snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (normalized_query_text, snapshotted_week)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS wb_query_frequency_history_week_idx
    ON ${tableName("wb_query_frequency_history")} (snapshotted_week DESC, monthly_frequency DESC)
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
  const deduplicatedRows = new Map<
    string,
    MonthlyFrequencyRow & {
      normalizedQueryText: string;
      normalizedQueryIdentity: string;
      normalizedQueryStem: string;
    }
  >();
  const totalRows = input.rows.length;
  let processedCount = 0;
  for (const row of input.rows) {
    const normalizedQueryText = input.normalizeAdvertisingText(row.queryText);
    const normalizedQueryIdentity = normalizeAdvertisingIdentity(row.queryText);
    const normalizedQueryStem = normalizedQueryIdentity
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .map((token) => stemToken(token))
      .join(" ");
    const existing = deduplicatedRows.get(normalizedQueryIdentity);
    if (!existing || row.monthlyFrequency > existing.monthlyFrequency) {
      deduplicatedRows.set(normalizedQueryIdentity, {
        ...row,
        normalizedQueryText,
        normalizedQueryIdentity,
        normalizedQueryStem,
      });
    }
    processedCount++;
    if (processedCount % 100_000 === 0) {
      process.stdout.write(`  Normalizing... ${processedCount}/${totalRows}\n`);
    }
  }
  console.log(`  Normalization done. Unique rows: ${deduplicatedRows.size}`);

  await client.query("BEGIN");
  try {
    await client.query(`DELETE FROM ${tableName("wb_search_query_frequencies")}`);

    // Disable statement timeout for large bulk inserts, restore after
    await client.query("SET statement_timeout = 0");

    const rowsArray = Array.from(deduplicatedRows.values());
    const chunkSize = 50_000; // ~30 roundtrips for 1.5M rows, each chunk ~8 MB

    for (let offset = 0; offset < rowsArray.length; offset += chunkSize) {
      const chunk = rowsArray.slice(offset, offset + chunkSize);
      const normalizedQueryTextArr: string[] = [];
      const normalizedQueryIdentityArr: string[] = [];
      const normalizedQueryStemArr: string[] = [];
      const queryTextArr: string[] = [];
      const monthlyFrequencyArr: number[] = [];
      const reportTypeArr: string[] = [];
      const reportIdArr: string[] = [];
      const downloadIdArr: string[] = [];
      const periodFromArr: string[] = [];
      const periodToArr: string[] = [];
      const subjectNameArr: (string | null)[] = [];
      for (const row of chunk) {
        normalizedQueryTextArr.push(row.normalizedQueryText);
        normalizedQueryIdentityArr.push(row.normalizedQueryIdentity);
        normalizedQueryStemArr.push(row.normalizedQueryStem);
        queryTextArr.push(row.queryText);
        monthlyFrequencyArr.push(row.monthlyFrequency);
        reportTypeArr.push(input.reportType);
        reportIdArr.push(input.reportId);
        downloadIdArr.push(input.downloadId);
        periodFromArr.push(input.period.from);
        periodToArr.push(input.period.to);
        subjectNameArr.push(row.subjectName ?? null);
      }
      await client.query(
        `INSERT INTO ${tableName("wb_search_query_frequencies")} (
            normalized_query_text, normalized_query_identity, normalized_query_stem,
            query_text, monthly_frequency, report_type, report_id, download_id,
            report_start_date, report_end_date, subject_name, synced_at
          )
          SELECT
            UNNEST($1::text[]), UNNEST($2::text[]), UNNEST($3::text[]),
            UNNEST($4::text[]), UNNEST($5::numeric[]), UNNEST($6::text[]),
            UNNEST($7::text[]), UNNEST($8::text[]),
            UNNEST($9::date[]), UNNEST($10::date[]),
            UNNEST($11::text[]), NOW()`,
        [
          normalizedQueryTextArr, normalizedQueryIdentityArr, normalizedQueryStemArr,
          queryTextArr, monthlyFrequencyArr, reportTypeArr,
          reportIdArr, downloadIdArr, periodFromArr, periodToArr, subjectNameArr,
        ],
      );
    }

    await client.query("COMMIT");

    // Best-effort weekly history snapshot — runs after the main atomic replace.
    // If it fails the current snapshot is still committed; history is supplementary.
    try {
      const historyRows = Array.from(deduplicatedRows.values()).map((r) => ({
        normalizedQueryText: r.normalizedQueryText,
        queryText: r.queryText,
        monthlyFrequency: r.monthlyFrequency,
      }));
      await appendFrequencyHistorySnapshot(client, { rows: historyRows, period: input.period });
    } catch (historyError) {
      console.error("Weekly frequency history snapshot failed (non-fatal):", historyError);
    }

    return deduplicatedRows.size;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/**
 * Monday of the ISO week containing the given date (or today if omitted).
 * Used as the dedup key for weekly history snapshots.
 */
function getSnapshotWeek(referenceIsoDate?: string): string {
  const d = referenceIsoDate ? new Date(referenceIsoDate) : new Date();
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

/**
 * Appends a weekly frequency snapshot to wb_query_frequency_history.
 * Uses ON CONFLICT DO UPDATE so re-running the same week overwrites cleanly.
 * Rows are chunked to stay within pg parameter limits.
 */
export async function appendFrequencyHistorySnapshot(
  client: Client,
  input: {
    rows: Array<{ normalizedQueryText: string; queryText: string; monthlyFrequency: number }>;
    period: MonthlyFrequencyImportPeriod;
  },
): Promise<number> {
  const snapshotWeek = getSnapshotWeek(input.period.to);
  const chunkSize = 500;
  let inserted = 0;

  for (let offset = 0; offset < input.rows.length; offset += chunkSize) {
    const chunk = input.rows.slice(offset, offset + chunkSize);
    const params: unknown[] = [];
    const placeholders = chunk.map((row, idx) => {
      const base = idx * 6;
      params.push(
        row.normalizedQueryText,
        row.queryText,
        row.monthlyFrequency,
        input.period.from,
        input.period.to,
        snapshotWeek,
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4}::date,$${base + 5}::date,$${base + 6}::date,NOW())`;
    });

    await client.query(
      `INSERT INTO ${tableName("wb_query_frequency_history")} (
         normalized_query_text, query_text, monthly_frequency,
         report_start_date, report_end_date, snapshotted_week, snapshotted_at
       ) VALUES ${placeholders.join(",")}
       ON CONFLICT (normalized_query_text, snapshotted_week)
       DO UPDATE SET
         monthly_frequency = EXCLUDED.monthly_frequency,
         report_start_date = EXCLUDED.report_start_date,
         report_end_date   = EXCLUDED.report_end_date,
         snapshotted_at    = NOW()`,
      params,
    );
    inserted += chunk.length;
  }

  return inserted;
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
