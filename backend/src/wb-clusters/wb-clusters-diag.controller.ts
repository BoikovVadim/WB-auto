import { Controller, Get, Inject, Query } from "@nestjs/common";

import { compareSheetVsSqlParity } from "./wb-clusters-sheet-sql-parity.diag";
import { WbClustersRepository } from "./wb-clusters.repository";

/**
 * ВРЕМЕННЫЙ диагностический контроллер (read-only). Используется один раз для сверки
 * SQL-агрегации per-cluster против JS-сборки sheet, прежде чем переключать /advertising-sheet
 * на SQL. Удалить после принятия решения. Ничего не мутирует.
 */
@Controller("wb-clusters/_diag")
export class WbClustersDiagController {
  constructor(
    @Inject(WbClustersRepository)
    private readonly wbClustersRepository: WbClustersRepository,
  ) {}

  @Get("sheet-vs-sql-parity")
  async sheetVsSqlParity(
    @Query("nmId") nmIdRaw: string,
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
  ) {
    const nmId = Number(nmIdRaw);
    return compareSheetVsSqlParity(this.wbClustersRepository, nmId, {
      start: startDate,
      end: endDate,
    });
  }

  @Get("sheet-vs-sql-parity-sweep")
  async sheetVsSqlParitySweep(
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
    @Query("limit") limitRaw?: string,
  ) {
    const period = { start: startDate, end: endDate };
    const limit = limitRaw ? Number(limitRaw) : 1000;
    const nmIds = (await this.wbClustersRepository.getKnownCatalogNmIds()).slice(0, limit);

    const perProduct: Array<{
      nmId: number;
      ok: boolean;
      mismatchCount?: number;
      queryCountMismatches?: number;
      frequencyMismatches?: number;
      comparedClusters?: number;
      error?: string;
    }> = [];

    let productsCompared = 0;
    let productsWithMismatch = 0;
    let totalMismatches = 0;
    let totalQueryCountMismatches = 0;
    let totalFrequencyMismatches = 0;
    let totalComparedClusters = 0;
    const worstExamples: Array<{ nmId: number; mismatches: unknown }> = [];

    // Серийно — sheet-сборка тяжёлая (грузит весь query-universe), параллель засушит пул.
    for (const nmId of nmIds) {
      try {
        const result = await compareSheetVsSqlParity(this.wbClustersRepository, nmId, period);
        productsCompared += 1;
        totalMismatches += result.mismatchCount;
        totalQueryCountMismatches += result.queryCountMismatches;
        totalFrequencyMismatches += result.frequencyMismatches;
        totalComparedClusters += result.comparedClusters;
        if (result.mismatchCount > 0) {
          productsWithMismatch += 1;
          if (worstExamples.length < 10) {
            worstExamples.push({ nmId, mismatches: result.mismatches.slice(0, 5) });
          }
        }
        perProduct.push({
          nmId,
          ok: true,
          mismatchCount: result.mismatchCount,
          queryCountMismatches: result.queryCountMismatches,
          frequencyMismatches: result.frequencyMismatches,
          comparedClusters: result.comparedClusters,
        });
      } catch (error) {
        perProduct.push({
          nmId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      period,
      productsRequested: nmIds.length,
      productsCompared,
      productsFailed: perProduct.filter((entry) => !entry.ok).length,
      productsWithMismatch,
      totalComparedClusters,
      totalMismatches,
      totalQueryCountMismatches,
      totalFrequencyMismatches,
      worstExamples,
      perProduct,
    };
  }
}
