import { Injectable } from "@nestjs/common";

import { WbClustersRepositoryRawDataRead } from "./wb-clusters.repository.raw-data-read";

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

@Injectable()
export class WbClustersRepository extends WbClustersRepositoryRawDataRead {}
