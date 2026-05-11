import { Inject, Injectable } from "@nestjs/common";

import { WbClustersRepository } from "./wb-clusters.repository";

@Injectable()
export class PromotionSyncRepository {
  constructor(
    @Inject(WbClustersRepository)
    private readonly wbClustersRepository: WbClustersRepository,
  ) {}

  isConfigured() {
    return this.wbClustersRepository.isConfigured();
  }

  failStaleRunningSyncs(reason: string) {
    return this.wbClustersRepository.failStaleRunningSyncs(reason);
  }

  getDashboardCounts() {
    return this.wbClustersRepository.getDashboardCounts();
  }

  getLastSyncRun() {
    return this.wbClustersRepository.getLastSyncRun();
  }

  getSyncCursorState(phase?: "inventory" | "structure" | "stats") {
    return this.wbClustersRepository.getSyncCursorState(phase);
  }
}
