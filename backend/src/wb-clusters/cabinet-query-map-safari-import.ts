import type { Client } from "pg";
import * as XLSX from "xlsx";

export type CabinetQueryMapRow = {
  clusterName: string;
  queryText: string;
};

export function buildCabinetQueryMapSourceEndpoint(advertId: number) {
  return `/api/v5/words-clusters?advertID=${advertId}`;
}

export function parseCabinetQueryMapWorkbookBuffer(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [] as CabinetQueryMapRow[];
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
  });
  const parsedRows: CabinetQueryMapRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const values = Object.values(row);
    const rawClusterName = values[0];
    const rawQueryText = values[1];
    const clusterName =
      typeof rawClusterName === "string" && rawClusterName.trim()
        ? rawClusterName.trim()
        : null;
    const queryText =
      typeof rawQueryText === "string" && rawQueryText.trim()
        ? rawQueryText.trim()
        : null;
    if (!clusterName || !queryText) {
      continue;
    }

    const key = `${normalizeCabinetQueryMapText(clusterName)}\u0000${normalizeCabinetQueryMapText(queryText)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    parsedRows.push({ clusterName, queryText });
  }

  return parsedRows;
}

export function chunkCabinetQueryMapRows(
  rows: CabinetQueryMapRow[],
  chunkSize: number,
) {
  if (rows.length === 0) {
    return [[]] as CabinetQueryMapRow[][];
  }

  const chunks: CabinetQueryMapRow[][] = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function replaceCabinetQueryMapRows(
  client: Client,
  input: {
    advertId: number;
    nmId: number;
    rows: CabinetQueryMapRow[];
    capturedAt: string;
    captureMode: string;
    sourceEndpoint: string | null;
  },
) {
  // Deduplicate by normalized_query_text: one cluster per query per campaign.
  // When the same query appears in multiple clusters (common in WB data), prefer
  // the row where the cluster IS named after the query (most canonical assignment).
  // This prevents the lookup from picking a "random" cluster for ambiguous queries.
  const bestByQueryText = new Map<
    string,
    { clusterName: string; normalizedClusterName: string; queryText: string }
  >();

  for (const row of input.rows) {
    const normalizedClusterName = normalizeCabinetQueryMapText(row.clusterName);
    const normalizedQueryText = normalizeCabinetQueryMapText(row.queryText);
    const existing = bestByQueryText.get(normalizedQueryText);
    if (!existing) {
      bestByQueryText.set(normalizedQueryText, { clusterName: row.clusterName, normalizedClusterName, queryText: row.queryText });
      continue;
    }
    // Prefer the row where cluster name === query text (exact cluster match wins).
    if (existing.normalizedClusterName !== normalizedQueryText && normalizedClusterName === normalizedQueryText) {
      bestByQueryText.set(normalizedQueryText, { clusterName: row.clusterName, normalizedClusterName, queryText: row.queryText });
    }
  }

  const keys: string[] = [];
  const clusterNames: string[] = [];
  const normalizedClusterNames: string[] = [];
  const queryTexts: string[] = [];
  const normalizedQueryTexts: string[] = [];

  for (const [normalizedQueryText, best] of bestByQueryText) {
    // Key no longer includes cluster name — one stable key per (advertId, nmId, query).
    keys.push(`${input.advertId}:${input.nmId}:cabinet:${normalizedQueryText}`);
    clusterNames.push(best.clusterName);
    normalizedClusterNames.push(best.normalizedClusterName);
    queryTexts.push(best.queryText);
    normalizedQueryTexts.push(normalizedQueryText);
  }

  await client.query("BEGIN");
  try {
    await client.query(
      `DELETE FROM public.wb_cabinet_cluster_queries WHERE advert_id = $1 AND nm_id = $2`,
      [input.advertId, input.nmId],
    );

    if (keys.length > 0) {
      await client.query(
        `
          INSERT INTO public.wb_cabinet_cluster_queries (
            cabinet_query_key, advert_id, nm_id,
            cluster_name, normalized_cluster_name,
            query_text, normalized_query_text,
            capture_mode, source_endpoint, captured_at, synced_at,
            monthly_frequency
          )
          SELECT
            u.cabinet_query_key, $2, $3,
            u.cluster_name, u.normalized_cluster_name,
            u.query_text, u.normalized_query_text,
            $8, $9, $10::timestamptz, NOW(),
            f.monthly_frequency
          FROM (
            SELECT
              UNNEST($1::text[]) AS cabinet_query_key,
              UNNEST($4::text[]) AS cluster_name,
              UNNEST($5::text[]) AS normalized_cluster_name,
              UNNEST($6::text[]) AS query_text,
              UNNEST($7::text[]) AS normalized_query_text
          ) u
          LEFT JOIN public.wb_search_query_frequencies f
            ON f.normalized_query_text = u.normalized_query_text
          ON CONFLICT (nm_id, advert_id, normalized_query_text) DO UPDATE SET
            cabinet_query_key       = EXCLUDED.cabinet_query_key,
            cluster_name            = EXCLUDED.cluster_name,
            normalized_cluster_name = EXCLUDED.normalized_cluster_name,
            query_text              = EXCLUDED.query_text,
            capture_mode            = EXCLUDED.capture_mode,
            source_endpoint         = EXCLUDED.source_endpoint,
            captured_at             = EXCLUDED.captured_at,
            synced_at               = NOW(),
            monthly_frequency       = COALESCE(EXCLUDED.monthly_frequency, public.wb_cabinet_cluster_queries.monthly_frequency)
        `,
        [
          keys,
          input.advertId,
          input.nmId,
          clusterNames,
          normalizedClusterNames,
          queryTexts,
          normalizedQueryTexts,
          input.captureMode,
          input.sourceEndpoint,
          input.capturedAt,
        ],
      );
    }

    await client.query("COMMIT");
    return bestByQueryText.size;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function normalizeCabinetQueryMapText(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
}
