import type { SafariBridgeResponse } from "./wb-cmp-safari.client.types";

export function parseSafariBridgeResponse(rawResponse: string): SafariBridgeResponse {
  if (!rawResponse) {
    throw new Error("Safari bridge returned an empty response.");
  }

  try {
    return JSON.parse(rawResponse) as SafariBridgeResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse Safari bridge response: ${message}`);
  }
}

export function parseWordsClustersWorkbookBuffer(
  rawResponse: string,
  advertId: number,
  nmId: number,
) {
  const response = parseSafariBridgeResponse(rawResponse);

  if (!response.ok || !response.base64) {
    throw new Error(
      response.error ??
        `Safari bridge returned an invalid words-clusters payload for advert ${advertId}, nm ${nmId}.`,
    );
  }

  if ((response.status ?? 0) < 200 || (response.status ?? 0) >= 300) {
    throw new Error(
      `Safari bridge returned HTTP ${response.status ?? "unknown"} for advert ${advertId}, nm ${nmId}.`,
    );
  }

  return Buffer.from(response.base64, "base64");
}
