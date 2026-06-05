import { Injectable } from "@nestjs/common";

import { WbClustersRepositoryPositions } from "./wb-clusters.repository.positions";

export type {
  PreferredProductAdvertisingSnapshotSummaryRecord,
  ProductAdvertisingSnapshotSummaryRecord,
  ProductPresetSnapshotJobRecordSummary,
  StoredProductAdvertisingSheetSnapshotRecord,
} from "./wb-clusters.repository.types";

export type {
  RawJamRow,
  RawCampaignRow,
  RawCampaignProductRow,
  RawSyncRunRow,
  RawClusterStatRow,
  RawDailyStatRow,
  RawMinusPhraseRow,
  RawQueryFrequencyRow,
} from "./wb-clusters.repository.raw-data-read";

export type { ChangeLogEntry } from "./wb-clusters.repository.change-log";
export type { DailyOrdersRow } from "./wb-clusters.repository.orders";
export type { DailyStocksRow } from "./wb-clusters.repository.stocks";

@Injectable()
export class WbClustersRepository extends WbClustersRepositoryPositions {}
