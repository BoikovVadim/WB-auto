import { WbClustersRepositoryAdvertisingSheetMetricsQueryLoader } from "./wb-clusters.repository.advertising-sheet-metrics-query-loader";

export abstract class WbClustersRepositoryAdvertisingSheetQueryLoader extends WbClustersRepositoryAdvertisingSheetMetricsQueryLoader {
  protected async loadProductAdvertisingSheetSourceData(
    nmId: number,
    currentPeriod: { start: string; end: string } | null,
  ) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    // Все три группы запросов независимы — запускаем параллельно.
    // Итоговая задержка = max(core, queries, metrics) вместо sum.
    const [
      { campaignsResult, clustersResult },
      { clusterQueriesResult, cabinetClusterQueriesResult },
      { dailyStatsResult, minusPhrasesResult, keywordStatsResult },
    ] = await Promise.all([
      this.loadProductAdvertisingSheetCoreRows(pool, nmId),
      this.loadProductAdvertisingSheetQueryRows(pool, nmId),
      this.loadProductAdvertisingSheetMetricsRows(pool, nmId, currentPeriod),
    ]);

    return {
      campaignsResult,
      clustersResult,
      clusterQueriesResult,
      cabinetClusterQueriesResult,
      dailyStatsResult,
      minusPhrasesResult,
      keywordStatsResult,
    };
  }
}
