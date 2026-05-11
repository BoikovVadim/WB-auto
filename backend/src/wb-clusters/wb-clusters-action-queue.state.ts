import { WbClustersRepository } from "./wb-clusters.repository";
import { WbPromotionApiClient } from "./wb-promotion-api.client";

export abstract class WbClustersActionQueueState {
  constructor(
    protected readonly wbClustersRepository: WbClustersRepository,
    protected readonly wbPromotionApiClient: WbPromotionApiClient,
  ) {}
}
