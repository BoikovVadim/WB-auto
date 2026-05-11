import { Client } from "pg";

import {
  buildCabinetQueryMapSourceEndpoint,
  chunkCabinetQueryMapRows,
  parseCabinetQueryMapWorkbookBuffer,
  replaceCabinetQueryMapRows,
} from "./cabinet-query-map-safari-import";
import {
  buildOptionalSafariImportPostgresConfig,
  buildSafariImportApiBaseUrl,
  loadSafariImportEnv,
} from "./safari-import.env";
import { ensureDarwinSafariRuntime, withTimeout } from "./safari-import.runtime";
import { WbCmpSafariClient } from "./wb-cmp-safari.client";

type CandidateRow = {
  advert_id: string;
  nm_id: string;
  existing_row_count: string;
  last_captured_at: string | null;
};

type ImportCandidate = {
  advertId: number;
  nmId: number;
  existingRowCount: number;
  lastCapturedAt: string | null;
};

async function loadCandidates(
  client: Client,
  limit: number,
  mode: "all" | "missing",
): Promise<ImportCandidate[]> {
  const missingOnlyClause =
    mode === "missing" ? "HAVING COUNT(cq.cabinet_query_key) = 0" : "";
  const result = await client.query<CandidateRow>(
    `
      SELECT
        cp.advert_id::text,
        cp.nm_id::text,
        COUNT(cq.cabinet_query_key)::text AS existing_row_count,
        MAX(cq.captured_at)::text AS last_captured_at
      FROM public.wb_campaign_products cp
      JOIN public.wb_campaigns c
        ON c.advert_id = cp.advert_id
      LEFT JOIN public.wb_cabinet_cluster_queries cq
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

async function main() {
  loadSafariImportEnv();
  const connectionConfig = buildOptionalSafariImportPostgresConfig();
  ensureDarwinSafariRuntime(
    "This batch importer must run on macOS because it uses Safari automation.",
  );

  const batchSize = Number.parseInt(process.env.WB_CMP_BATCH_SIZE ?? "10", 10);
  const itemTimeoutMs = Number.parseInt(process.env.WB_CMP_ITEM_TIMEOUT_MS ?? "90000", 10);
  const mode = process.env.WB_CMP_IMPORT_MODE === "missing" ? "missing" : "all";
  const forcedAdvertId = Number.parseInt(process.env.WB_CMP_IMPORT_ADVERT_ID ?? "", 10);
  const forcedNmId = Number.parseInt(process.env.WB_CMP_IMPORT_NM_ID ?? "", 10);
  const safariClient = new WbCmpSafariClient();
  const apiBaseUrl = buildSafariImportApiBaseUrl();
  const client = connectionConfig ? new Client(connectionConfig) : null;
  if (client) {
    await client.connect();
  }

  try {
    const candidates =
      Number.isFinite(forcedAdvertId) && Number.isFinite(forcedNmId)
        ? [
            {
              advertId: forcedAdvertId,
              nmId: forcedNmId,
              existingRowCount: 0,
              lastCapturedAt: null,
            },
          ]
        : client
          ? await loadCandidates(client, batchSize, mode)
          : await loadCandidatesViaApi(apiBaseUrl, batchSize, mode);
    console.log(
      `Loaded ${candidates.length} candidates for this batch in ${mode} mode via ${client ? "database" : "api"}.`,
    );

    let succeeded = 0;
    let failed = 0;

    for (const [index, candidate] of candidates.entries()) {
      console.log(
        `[${index + 1}/${candidates.length}] Starting advert ${candidate.advertId}, nm ${candidate.nmId} (existing rows: ${candidate.existingRowCount}, last captured: ${candidate.lastCapturedAt ?? "never"})...`,
      );
      try {
        const workbook = await withTimeout(
          safariClient.exportWordsClusters(candidate.advertId, candidate.nmId),
          itemTimeoutMs,
          `WB cmp export for advert ${candidate.advertId}, nm ${candidate.nmId}`,
        );
        const parsedRows = parseCabinetQueryMapWorkbookBuffer(workbook);
        const capturedAt = new Date().toISOString();
        const savedRows = client
          ? await replaceCabinetQueryMapRows(client, {
              advertId: candidate.advertId,
              nmId: candidate.nmId,
              rows: parsedRows,
              capturedAt,
              captureMode: "safari-single-tab-words-clusters",
              sourceEndpoint: buildCabinetQueryMapSourceEndpoint(candidate.advertId),
            })
          : await importCabinetClusterQueriesViaApi(apiBaseUrl, {
              advertId: candidate.advertId,
              nmId: candidate.nmId,
              capturedAt,
              rows: parsedRows,
            });
        succeeded += 1;
        console.log(
          `Saved ${savedRows} cabinet query-map rows for advert ${candidate.advertId}, nm ${candidate.nmId}.`,
        );
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `Failed advert ${candidate.advertId}, nm ${candidate.nmId}: ${message}`,
        );
      }
    }

    console.log(
      `Batch completed. Succeeded: ${succeeded}. Failed: ${failed}. Total attempted: ${candidates.length}.`,
    );
  } finally {
    if (client) {
      await client.end();
    }
  }
}

async function loadCandidatesViaApi(
  apiBaseUrl: string,
  limit: number,
  mode: "all" | "missing",
): Promise<ImportCandidate[]> {
  const searchParams = new URLSearchParams({
    limit: String(limit),
    mode,
  });
  const response = await fetch(
    `${apiBaseUrl}/wb-clusters/cabinet/query-map/candidates?${searchParams.toString()}`,
  );
  if (!response.ok) {
    throw new Error(
      `Candidate API returned HTTP ${response.status} ${response.statusText}.`,
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      advertId?: number;
      nmId?: number;
      existingRowCount?: number;
      lastCapturedAt?: string | null;
    }>;
  };
  if (!Array.isArray(payload.candidates)) {
    throw new Error("Candidate API returned an invalid payload.");
  }

  return payload.candidates
    .filter(
      (item) =>
        typeof item.advertId === "number" &&
        typeof item.nmId === "number" &&
        typeof item.existingRowCount === "number",
    )
    .map((item) => ({
      advertId: item.advertId as number,
      nmId: item.nmId as number,
      existingRowCount: item.existingRowCount as number,
      lastCapturedAt: item.lastCapturedAt ?? null,
    }));
}

async function importCabinetClusterQueriesViaApi(
  apiBaseUrl: string,
  input: {
    advertId: number;
    nmId: number;
    capturedAt: string;
    rows: Array<{ clusterName: string; queryText: string }>;
  },
) {
  const uploadChunkSize = Number.parseInt(process.env.WB_CMP_IMPORT_UPLOAD_CHUNK_SIZE ?? "500", 10);
  const chunks = chunkCabinetQueryMapRows(input.rows, Math.max(1, uploadChunkSize));
  let totalRowsStored = 0;

  for (const [index, chunk] of chunks.entries()) {
    const response = await fetch(`${apiBaseUrl}/wb-clusters/cabinet/query-map/import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        advertId: input.advertId,
        nmId: input.nmId,
        capturedAt: input.capturedAt,
        captureMode: "safari-single-tab-words-clusters",
        sourceEndpoint: buildCabinetQueryMapSourceEndpoint(input.advertId),
        replaceExisting: index === 0,
        rows: chunk,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Import API returned HTTP ${response.status} ${response.statusText} on chunk ${index + 1}/${chunks.length}.`,
      );
    }

    const payload = (await response.json()) as { rowsStored?: number };
    if (typeof payload.rowsStored !== "number") {
      throw new Error("Import API returned an invalid payload.");
    }
    totalRowsStored += payload.rowsStored;
  }

  return totalRowsStored;
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
