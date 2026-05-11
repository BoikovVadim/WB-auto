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
  await client.query("BEGIN");
  try {
    await client.query(
      `DELETE FROM public.wb_cabinet_cluster_queries WHERE advert_id = $1 AND nm_id = $2`,
      [input.advertId, input.nmId],
    );

    const seenRows = new Set<string>();
    for (const row of input.rows) {
      const normalizedClusterName = normalizeCabinetQueryMapText(row.clusterName);
      const normalizedQueryText = normalizeCabinetQueryMapText(row.queryText);
      const rowKey = `${normalizedClusterName}:${normalizedQueryText}`;
      if (seenRows.has(rowKey)) {
        continue;
      }
      seenRows.add(rowKey);

      const cabinetQueryKey = `${input.advertId}:${input.nmId}:cabinet:${normalizedClusterName}:${normalizedQueryText}`;
      await client.query(
        `
          INSERT INTO public.wb_cabinet_cluster_queries (
            cabinet_query_key,
            advert_id,
            nm_id,
            cluster_name,
            normalized_cluster_name,
            query_text,
            normalized_query_text,
            capture_mode,
            source_endpoint,
            captured_at,
            synced_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,NOW())
          ON CONFLICT (cabinet_query_key) DO UPDATE
          SET
            cluster_name = EXCLUDED.cluster_name,
            normalized_cluster_name = EXCLUDED.normalized_cluster_name,
            query_text = EXCLUDED.query_text,
            normalized_query_text = EXCLUDED.normalized_query_text,
            capture_mode = EXCLUDED.capture_mode,
            source_endpoint = EXCLUDED.source_endpoint,
            captured_at = EXCLUDED.captured_at,
            synced_at = NOW()
        `,
        [
          cabinetQueryKey,
          input.advertId,
          input.nmId,
          row.clusterName,
          normalizedClusterName,
          row.queryText,
          normalizedQueryText,
          input.captureMode,
          input.sourceEndpoint,
          input.capturedAt,
        ],
      );
    }

    await client.query("COMMIT");
    return seenRows.size;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function normalizeCabinetQueryMapText(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
}
