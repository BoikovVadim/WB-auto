import { WbPromotionApiClient } from "./wb-promotion-api.client";
import { WbClustersRepository } from "./wb-clusters.repository";

export abstract class WbClustersBidQueueState {
  constructor(
    protected readonly wbClustersRepository: WbClustersRepository,
    protected readonly wbPromotionApiClient: WbPromotionApiClient,
  ) {}
}
