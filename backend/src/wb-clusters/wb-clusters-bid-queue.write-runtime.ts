import { ServiceUnavailableException } from "@nestjs/common";

import { WbClustersBidQueueState } from "./wb-clusters-bid-queue.state";
import type { PromotionSetNormQueryBidsRequest } from "./wb-clusters.types";

export abstract class WbClustersBidQueueWriteRuntime extends WbClustersBidQueueState {
  protected async setNormQueryBidsWithQuickRetry(
    input: PromotionSetNormQueryBidsRequest,
    isRecoverablePromotionError: (error: unknown) => boolean,
  ) {
    const retryDelaysMs = [0];
    let lastError: unknown = null;

    for (let attemptIndex = 0; attemptIndex < retryDelaysMs.length; attemptIndex += 1) {
      const delayMs = retryDelaysMs[attemptIndex] ?? 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        await this.wbPromotionApiClient.setNormQueryBids(input, {
          failFastOnTooManyRequests: true,
          maxQueueWaitMs: 2_000,
        });
        return attemptIndex + 1;
      } catch (error) {
        lastError = error;
        if (!isRecoverablePromotionError(error) || attemptIndex === retryDelaysMs.length - 1) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ServiceUnavailableException(
          "Не удалось применить ставку в WB Promotion API после быстрых повторов.",
        );
  }

  protected chunkArray<T>(items: T[], chunkSize: number) {
    if (chunkSize <= 0) {
      return [items];
    }

    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += chunkSize) {
      chunks.push(items.slice(index, index + chunkSize));
    }

    return chunks;
  }

}
