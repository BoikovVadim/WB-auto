import path from "node:path";
import dotenv from "dotenv";
import { Client, type ClientConfig } from "pg";
import * as XLSX from "xlsx";
import { WbCmpSafariClient } from "./wb-cmp-safari.client";

const envFiles = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(process.cwd(), "..", ".env.local"),
];

for (const envFile of envFiles) {
  dotenv.config({ path: envFile, override: true });
}

type CandidateRow = {
  advert_id: string;
  nm_id: string;
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
}

async function exportWordsClusters(advertId: number, nmId: number) {
  const safariClient = new WbCmpSafariClient();
  return safariClient.exportWordsClusters(advertId, nmId);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function parseWorkbook(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return {
      rows: [] as Array<{ clusterName: string; queryText: string }>,
      debug: {
        firstSheetName: null as string | null,
        jsonRowsPreview: [] as Record<string, unknown>[],
      },
    };
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
  });
  const parsedRows: Array<{ clusterName: string; queryText: string }> = [];
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

    const key = `${normalize(clusterName)}\u0000${normalize(queryText)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    parsedRows.push({ clusterName, queryText });
  }

  return {
    rows: parsedRows,
    debug: {
      firstSheetName,
      jsonRowsPreview: rows.slice(0, 5),
    },
  };
}

async function replaceCabinetClusterQueries(
  client: Client,
  advertId: number,
  nmId: number,
  rows: Array<{ clusterName: string; queryText: string }>,
  capturedAt: string,
) {
  await client.query("BEGIN");
  try {
    await client.query(
      `DELETE FROM public.wb_cabinet_cluster_queries WHERE advert_id = $1 AND nm_id = $2`,
      [advertId, nmId],
    );

    for (const row of rows) {
      const normalizedClusterName = normalize(row.clusterName);
      const normalizedQueryText = normalize(row.queryText);
      const cabinetQueryKey = `${advertId}:${nmId}:cabinet:${normalizedClusterName}:${normalizedQueryText}`;
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
          advertId,
          nmId,
          row.clusterName,
          normalizedClusterName,
          row.queryText,
          normalizedQueryText,
          "safari-single-tab-words-clusters",
          `/api/v5/words-clusters?advertID=${advertId}`,
          capturedAt,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const connectionConfig = buildClientConfig();
  if (!connectionConfig) {
    throw new Error("DATABASE_URL or PGHOST/PGUSER/PGDATABASE is required.");
  }

  if (process.platform !== "darwin") {
    throw new Error("This script must run on macOS because it uses Safari automation.");
  }

  const limit = Number.parseInt(process.env.WB_CMP_IMPORT_LIMIT ?? "25", 10);
  const forcedAdvertId = Number.parseInt(process.env.WB_CMP_IMPORT_ADVERT_ID ?? "", 10);
  const forcedNmId = Number.parseInt(process.env.WB_CMP_IMPORT_NM_ID ?? "", 10);
  const debugEnabled = process.env.WB_CMP_IMPORT_DEBUG === "1";
  const importTimeoutMs = Number.parseInt(process.env.WB_CMP_IMPORT_TIMEOUT_MS ?? "90000", 10);
  const client = new Client(connectionConfig);
  await client.connect();

  try {
    const candidates =
      Number.isFinite(forcedAdvertId) && Number.isFinite(forcedNmId)
        ? {
            rowCount: 1,
            rows: [
              {
                advert_id: String(forcedAdvertId),
                nm_id: String(forcedNmId),
              },
            ] satisfies CandidateRow[],
          }
        : await client.query<CandidateRow>(
            `
              SELECT cp.advert_id::text, cp.nm_id::text
              FROM public.wb_campaign_products cp
              JOIN public.wb_campaigns c
                ON c.advert_id = cp.advert_id
              LEFT JOIN public.wb_cabinet_cluster_queries cq
                ON cq.advert_id = cp.advert_id
               AND cq.nm_id = cp.nm_id
              WHERE cq.advert_id IS NULL
              ORDER BY
                CASE WHEN c.campaign_status IN (9, 11) THEN 0 ELSE 1 END,
                cp.advert_id DESC,
                cp.nm_id
              LIMIT $1
            `,
            [limit],
          );

    console.log(`Found ${candidates.rowCount ?? 0} products without Safari query-map rows.`);

    let processed = 0;
    for (const row of candidates.rows) {
      const advertId = Number(row.advert_id);
      const nmId = Number(row.nm_id);
      console.log(`Importing advert ${advertId}, nm ${nmId}...`);
      try {
        const workbook = await withTimeout(
          exportWordsClusters(advertId, nmId),
          importTimeoutMs,
          `WB cmp export for advert ${advertId}, nm ${nmId}`,
        );
        const parsedWorkbook = parseWorkbook(workbook);
        const parsedRows = parsedWorkbook.rows;
        if (debugEnabled) {
          console.log(
            JSON.stringify(
              {
                advertId,
                nmId,
                workbookBytes: workbook.length,
                firstSheetName: parsedWorkbook.debug.firstSheetName,
                jsonRowsPreview: parsedWorkbook.debug.jsonRowsPreview,
                parsedRows: parsedRows.length,
                sample: parsedRows.slice(0, 5),
              },
              null,
              2,
            ),
          );
        }
        await replaceCabinetClusterQueries(
          client,
          advertId,
          nmId,
          parsedRows,
          new Date().toISOString(),
        );
        processed += 1;
        console.log(
          `Saved ${parsedRows.length} cabinet query-map rows for advert ${advertId}, nm ${nmId}.`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Skipping advert ${advertId}, nm ${nmId}: ${message}`);
      }
    }

    console.log(`Completed ${processed} imports.`);
  } finally {
    await client.end();
  }
}

function buildClientConfig(): ClientConfig | null {
  const connectionString = (process.env.DATABASE_URL ?? "").trim();
  if (connectionString) {
    return { connectionString };
  }

  const host = (process.env.PGHOST ?? "").trim();
  const user = (process.env.PGUSER ?? "").trim();
  const database = (process.env.PGDATABASE ?? "").trim();
  if (!host || !user || !database) {
    return null;
  }

  const port = Number.parseInt((process.env.PGPORT ?? "5432").trim(), 10);
  return {
    host,
    user,
    database,
    password: process.env.PGPASSWORD ?? "",
    port: Number.isFinite(port) ? port : 5432,
  };
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
