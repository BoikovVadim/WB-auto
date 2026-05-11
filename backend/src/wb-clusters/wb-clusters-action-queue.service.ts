import { Injectable } from "@nestjs/common";

import { WbPromotionApiClient } from "./wb-promotion-api.client";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbClustersActionQueueWrite } from "./wb-clusters-action-queue.write";

@Injectable()
export class WbClustersActionQueueService extends WbClustersActionQueueWrite {
  constructor(
    wbClustersRepository: WbClustersRepository,
    wbPromotionApiClient: WbPromotionApiClient,
  ) {
    super(wbClustersRepository, wbPromotionApiClient);
  }
}
