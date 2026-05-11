import type { ProductAdvertisingSheetResponse } from "./wb-clusters.types";
import { WbClustersRepositoryWorkspaceFastSql } from "./wb-clusters.repository.workspace-fast-sql";

export abstract class WbClustersRepositoryAdvertisingSheetRead extends WbClustersRepositoryWorkspaceFastSql {
  async getProductAdvertisingSheet(input: {
    nmId: number;
    currentPeriod?: { start: string; end: string } | null;
  }): Promise<ProductAdvertisingSheetResponse> {
    if (!this.isConfigured()) {
      return this.createEmptyProductAdvertisingSheet(input.nmId);
    }

    return this.buildProductAdvertisingSheetReadModel(input);
  }
}
