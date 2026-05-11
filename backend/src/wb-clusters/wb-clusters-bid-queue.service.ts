import { Injectable } from "@nestjs/common";

import { WbPromotionApiClient } from "./wb-promotion-api.client";
import { WbClustersBidQueueReconcile } from "./wb-clusters-bid-queue.reconcile";
import { WbClustersRepository } from "./wb-clusters.repository";

@Injectable()
export class WbClustersBidQueueService extends WbClustersBidQueueReconcile {
  constructor(
    wbClustersRepository: WbClustersRepository,
    wbPromotionApiClient: WbPromotionApiClient,
  ) {
    super(wbClustersRepository, wbPromotionApiClient);
  }
}
