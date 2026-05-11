import { Inject, Injectable } from "@nestjs/common";

import {
  type PreferredProductAdvertisingSnapshotSummaryRecord,
  type ProductAdvertisingSnapshotSummaryRecord,
  type StoredProductAdvertisingSheetSnapshotRecord,
  WbClustersRepository,
} from "./wb-clusters.repository";
import type { ProductAdvertisingSheetResponse } from "./wb-clusters.types";

@Injectable()
export class ProductAdvertisingSnapshotRepository {
  constructor(
    @Inject(WbClustersRepository)
    private readonly wbClustersRepository: WbClustersRepository,
  ) {}

  getExactReadySnapshot(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
  }): Promise<StoredProductAdvertisingSheetSnapshotRecord | null> {
    return this.wbClustersRepository.getStoredProductAdvertisingSheetSnapshot(input);
  }

  async getExactReadySnapshotSummary(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
  }): Promise<ProductAdvertisingSnapshotSummaryRecord | null> {
    const [summary] = await this.wbClustersRepository.getExactReadyProductAdvertisingSnapshotSummaries({
      nmIds: [input.nmId],
      startDate: input.startDate,
      endDate: input.endDate,
      schemaVersion: input.schemaVersion,
    });
    return summary ?? null;
  }

  getLatestReadySnapshotForRange(input: {
    nmId: number;
    startDate: string;
    endDate: string;
  }): Promise<StoredProductAdvertisingSheetSnapshotRecord | null> {
    return this.wbClustersRepository.getLatestStoredProductAdvertisingSheetSnapshot(input);
  }

  async getLatestReadySnapshotSummaryForRange(input: {
    nmId: number;
    startDate: string;
    endDate: string;
  }): Promise<ProductAdvertisingSnapshotSummaryRecord | null> {
    const [summary] =
      await this.wbClustersRepository.getLatestReadyProductAdvertisingSnapshotSummariesForRange({
        nmIds: [input.nmId],
        startDate: input.startDate,
        endDate: input.endDate,
      });
    return summary ?? null;
  }

  getMostRecentReadySnapshot(
    nmId: number,
  ): Promise<StoredProductAdvertisingSheetSnapshotRecord | null> {
    return this.wbClustersRepository.getMostRecentStoredProductAdvertisingSheetSnapshot(nmId);
  }

  async getMostRecentReadySnapshotSummary(
    nmId: number,
  ): Promise<ProductAdvertisingSnapshotSummaryRecord | null> {
    const [summary] =
      await this.wbClustersRepository.getMostRecentReadyProductAdvertisingSnapshotSummaries([nmId]);
    return summary ?? null;
  }

  getClosestReadySnapshotForRange(input: {
    nmId: number;
    startDate: string;
    endDate: string;
  }): Promise<StoredProductAdvertisingSheetSnapshotRecord | null> {
    return this.wbClustersRepository.getClosestStoredProductAdvertisingSheetSnapshotForRange(input);
  }

  async getClosestReadySnapshotSummaryForRange(input: {
    nmId: number;
    startDate: string;
    endDate: string;
  }): Promise<ProductAdvertisingSnapshotSummaryRecord | null> {
    const [summary] =
      await this.wbClustersRepository.getClosestReadyProductAdvertisingSnapshotSummariesForRange({
        nmIds: [input.nmId],
        startDate: input.startDate,
        endDate: input.endDate,
      });
    return summary ?? null;
  }

  getPreferredReadySnapshotSummariesForRange(input: {
    nmIds: number[];
    startDate: string;
    endDate: string;
    schemaVersion: number;
  }): Promise<PreferredProductAdvertisingSnapshotSummaryRecord[]> {
    return this.wbClustersRepository.getPreferredReadyProductAdvertisingSnapshotSummariesForRange(
      input,
    );
  }

  getReadySnapshotBySummary(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
  }): Promise<StoredProductAdvertisingSheetSnapshotRecord | null> {
    return this.wbClustersRepository.getStoredProductAdvertisingSheetSnapshot(input);
  }

  getReadySnapshotsByKeys(
    input: Array<{
      nmId: number;
      startDate: string;
      endDate: string;
      schemaVersion: number;
    }>,
  ) {
    return this.wbClustersRepository.getStoredProductAdvertisingSheetSnapshotsByKeys(input);
  }

  listReadySnapshotsMissingSchemaVersion(schemaVersion: number, limit = 200) {
    return this.wbClustersRepository.listReadyProductAdvertisingSheetSnapshotsMissingSchemaVersion(
      schemaVersion,
      limit,
    );
  }

  saveReadySnapshot(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
    payload: ProductAdvertisingSheetResponse;
    builtFromExportRequestId?: string | null;
    sourceKind?: string;
    lastAttemptAt?: string | null;
  }) {
    return this.wbClustersRepository.replaceStoredProductAdvertisingSheetSnapshot({
      ...input,
      status: "ready",
      readyAt: new Date().toISOString(),
      failureReason: null,
    });
  }

  deleteSnapshot(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
  }) {
    return this.wbClustersRepository.deleteStoredProductAdvertisingSheetSnapshot(input);
  }
}
