import type { WbClustersRepository } from "./wb-clusters.repository";

/**
 * ВРЕМЕННЫЙ read-only харнесс сверки. Сравнивает per-cluster queryCount/monthlyFrequency
 * двух реализаций:
 *   - JS-сборка полного sheet (buildProductAdvertisingSheetReadModel, грузит весь
 *     query-universe в JS и считает с identity-дедупом) — repo.getProductAdvertisingSheet
 *   - SQL-агрегация живого пути (getProductWorkspaceCampaignRowsSQL: query_counts/
 *     frequency_by_cluster CTE, дедуп по identity в SQL)
 *
 * Цель: доказать (или опровергнуть) что SQL-числа == JS-числа по всем кластерам, прежде
 * чем переключать сборку sheet на SQL и перестать грузить 216k строк в JS. Ничего не
 * меняет — только читает и сравнивает. Удалить после принятия решения.
 */
function normClusterName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

function freqDiffers(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  // monthly_frequency — суммы целочисленных частот; допускаем крошечную float-погрешность.
  return Math.abs(a - b) > 0.5;
}

export interface SheetSqlParityMismatch {
  advertId: number;
  clusterName: string;
  sheetQueryCount: number | null;
  sqlQueryCount: number | null;
  sheetMonthlyFrequency: number | null;
  sqlMonthlyFrequency: number | null;
  sqlRowFound: boolean;
}

export async function compareSheetVsSqlParity(
  repo: WbClustersRepository,
  nmId: number,
  period: { start: string; end: string },
) {
  const sheet = await repo.getProductAdvertisingSheet({ nmId, currentPeriod: period });

  const advertIds = Array.from(
    new Set(
      sheet.clusters
        .map((cluster) => cluster.advertId)
        .filter((value): value is number => value !== null),
    ),
  );

  const sqlByKey = new Map<
    string,
    { queryCount: number | null; monthlyFrequency: number | null }
  >();
  for (const advertId of advertIds) {
    const snapshot = await repo.getProductWorkspaceCampaignRowsSQL(nmId, advertId, period);
    for (const row of snapshot.rows) {
      if (row.advertId === null) continue;
      sqlByKey.set(`${row.advertId}:${normClusterName(row.clusterName)}`, {
        queryCount: row.queryCount,
        monthlyFrequency: row.monthlyFrequency,
      });
    }
  }

  const mismatches: SheetSqlParityMismatch[] = [];
  let comparedClusters = 0;
  for (const cluster of sheet.clusters) {
    if (cluster.advertId === null) continue;
    comparedClusters += 1;
    const key = `${cluster.advertId}:${normClusterName(cluster.clusterName)}`;
    const sql = sqlByKey.get(key);
    const sheetQueryCount = cluster.queryCount ?? null;
    const sheetMonthlyFrequency = cluster.monthlyFrequency ?? null;
    const sqlQueryCount = sql?.queryCount ?? null;
    const sqlMonthlyFrequency = sql?.monthlyFrequency ?? null;

    if (
      sheetQueryCount !== sqlQueryCount ||
      freqDiffers(sheetMonthlyFrequency, sqlMonthlyFrequency)
    ) {
      mismatches.push({
        advertId: cluster.advertId,
        clusterName: cluster.clusterName,
        sheetQueryCount,
        sqlQueryCount,
        sheetMonthlyFrequency,
        sqlMonthlyFrequency,
        sqlRowFound: Boolean(sql),
      });
    }
  }

  const queryCountMismatches = mismatches.filter(
    (mismatch) => mismatch.sheetQueryCount !== mismatch.sqlQueryCount,
  ).length;
  const frequencyMismatches = mismatches.filter((mismatch) =>
    freqDiffers(mismatch.sheetMonthlyFrequency, mismatch.sqlMonthlyFrequency),
  ).length;

  return {
    nmId,
    period,
    advertIds: advertIds.length,
    sheetClusters: sheet.clusters.length,
    comparedClusters,
    mismatchCount: mismatches.length,
    queryCountMismatches,
    frequencyMismatches,
    mismatches: mismatches.slice(0, 50),
  };
}
