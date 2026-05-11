import {
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";

type WbClustersService = any;

export async function getCampaignCountsWithQuickRetry(
  self: WbClustersService,
  label: string,
  warningMessages: string[],
) {
  return self.tryPromotionStepWithQuickRetry(
    label,
    () =>
      self.wbPromotionApiClient.getCampaignCounts({
        failFastOnTooManyRequests: true,
        maxQueueWaitMs: 20_000,
      }),
    warningMessages,
  );
}

export async function getCampaignDetailsWithQuickRetry(
  self: WbClustersService,
  advertIds: number[],
  label: string,
  warningMessages: string[],
) {
  return self.tryPromotionStepWithQuickRetry(
    label,
    () =>
      self.wbPromotionApiClient.getCampaignDetails(advertIds, {
        failFastOnTooManyRequests: true,
        maxQueueWaitMs: 20_000,
      }),
    warningMessages,
  );
}

export async function tryPromotionStepWithQuickRetry<T>(
  self: WbClustersService,
  label: string,
  action: () => Promise<T>,
  warningMessages: string[],
): Promise<T | null> {
  const retryDelaysMs = [0, 3_000, 8_000, 15_000];
  let lastError: unknown = null;

  for (let attemptIndex = 0; attemptIndex < retryDelaysMs.length; attemptIndex += 1) {
    const delayMs = retryDelaysMs[attemptIndex] ?? 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!self.isRecoverablePromotionError(error)) {
        throw error;
      }
    }
  }

  const warning = `${label}: ${self.describeError(lastError)}`;
  self.logger.warn(warning);
  self.pushWarning(warningMessages, warning);
  return null;
}

export async function tryAnalyticsStep<T>(
  self: WbClustersService,
  label: string,
  action: () => Promise<T>,
  warningMessages: string[],
): Promise<T | null> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof HttpException)) {
      throw error;
    }

    const warning = `${label}: ${self.describeError(error)}`;
    self.logger.warn(warning);
    self.pushWarning(warningMessages, warning);
    return null;
  }
}

export async function tryApiStep<T>(
  self: WbClustersService,
  label: string,
  action: () => Promise<T>,
  warningMessages: string[],
): Promise<T | null> {
  try {
    return await action();
  } catch (error) {
    if (!self.isRecoverablePromotionError(error)) {
      throw error;
    }

    const warning = `${label}: ${self.describeError(error)}`;
    self.logger.warn(warning);
    self.pushWarning(warningMessages, warning);
    return null;
  }
}

export async function tryCmpStep<T>(
  self: WbClustersService,
  label: string,
  action: () => Promise<T>,
  warningMessages: string[],
): Promise<T | null> {
  try {
    return await Promise.race([
      action(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new ServiceUnavailableException(
              `${label} timed out after ${self.cmpStepTimeoutMs}ms.`,
            ),
          );
        }, self.cmpStepTimeoutMs);
      }),
    ]);
  } catch (error) {
    const warning = `${label}: ${self.describeError(error)}`;
    self.logger.warn(warning);
    self.pushWarning(warningMessages, warning);
    return null;
  }
}

export function isRecoverablePromotionError(self: WbClustersService, error: unknown) {
  if (!(error instanceof HttpException)) {
    return false;
  }

  const status = error.getStatus();
  return (
    status === HttpStatus.TOO_MANY_REQUESTS ||
    status === HttpStatus.BAD_GATEWAY ||
    status === HttpStatus.SERVICE_UNAVAILABLE ||
    status === HttpStatus.GATEWAY_TIMEOUT
  );
}

export function describeError(self: WbClustersService, error: unknown) {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response && typeof response === "object") {
      const message =
        "message" in response && typeof response.message === "string"
          ? response.message
          : error.message;
      const statusCode =
        "statusCode" in response && typeof response.statusCode === "number"
          ? response.statusCode
          : error.getStatus();
      const responseMeta =
        "responseMeta" in response &&
        response.responseMeta &&
        typeof response.responseMeta === "object"
          ? response.responseMeta
          : null;

      const retryPart =
        responseMeta &&
        "rateLimitRetry" in responseMeta &&
        typeof responseMeta.rateLimitRetry === "number"
          ? ` retry=${responseMeta.rateLimitRetry}s`
          : "";
      const resetPart =
        responseMeta &&
        "rateLimitReset" in responseMeta &&
        typeof responseMeta.rateLimitReset === "number"
          ? ` reset=${responseMeta.rateLimitReset}s`
          : "";
      const requestIdPart =
        responseMeta &&
        "requestId" in responseMeta &&
        typeof responseMeta.requestId === "string" &&
        responseMeta.requestId.length > 0
          ? ` requestId=${responseMeta.requestId}`
          : "";

      return `${message} [status=${statusCode}${retryPart}${resetPart}${requestIdPart}]`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown WB API error";
}

export function pushWarning(self: WbClustersService, warningMessages: string[], message: string) {
  if (!warningMessages.includes(message)) {
    warningMessages.push(message);
  }
}

export function summarizeWarnings(self: WbClustersService, warningMessages: string[]) {
  if (warningMessages.length === 0) {
    return null;
  }

  return warningMessages.slice(0, 5).join(" | ");
}
