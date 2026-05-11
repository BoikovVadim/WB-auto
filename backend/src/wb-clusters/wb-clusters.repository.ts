import { Injectable } from "@nestjs/common";

import { WbClustersRepositoryWorkspaceSnapshotStorage } from "./wb-clusters.repository.workspace-snapshot-storage";

export type {
  PreferredProductAdvertisingSnapshotSummaryRecord,
  ProductAdvertisingSnapshotSummaryRecord,
  ProductPresetSnapshotJobRecordSummary,
  StoredProductAdvertisingSheetSnapshotRecord,
} from "./wb-clusters.repository.types";

@Injectable()
export class WbClustersRepository extends WbClustersRepositoryWorkspaceSnapshotStorage {}
