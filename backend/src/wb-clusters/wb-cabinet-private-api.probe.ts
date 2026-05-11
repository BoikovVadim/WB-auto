import type { WbCabinetCmpProbeResponse } from "./wb-clusters.types";
import { buildCmpCampaignUrl, type WordsClustersFetchResponse } from "./wb-cabinet-private-api.cmp";

export function buildWordsClustersFetchError(
  advertId: number,
  nmId: number,
  status: number | null,
) {
  return `WB cabinet private API words-clusters fetch failed for advert ${advertId}, nm ${nmId} with status ${String(status)}.`;
}

export function buildCmpProbeResponse(input: {
  advertId: number;
  nmId: number;
  fetchResponse: WordsClustersFetchResponse;
  rowCount: number;
}): WbCabinetCmpProbeResponse {
  const { advertId, nmId, fetchResponse, rowCount } = input;
  return {
    advertId,
    nmId,
    status: fetchResponse.ok ? "ok" : "failed",
    pageUrl: fetchResponse.pageUrl,
    capturedAt: fetchResponse.capturedAt,
    requestCount: fetchResponse.requests.length,
    requests: fetchResponse.requests,
    workbook: {
      ok: fetchResponse.ok,
      status: fetchResponse.status,
      rowCount,
      sourceEndpoint: fetchResponse.sourceEndpoint,
    },
    warning: fetchResponse.ok ? null : "WB cabinet probe did not return a successful workbook.",
  };
}

export function buildCmpProbeFailure(
  advertId: number,
  nmId: number,
  error: unknown,
): WbCabinetCmpProbeResponse {
  return {
    advertId,
    nmId,
    status: "failed",
    pageUrl: buildCmpCampaignUrl(advertId, nmId),
    capturedAt: new Date().toISOString(),
    requestCount: 0,
    requests: [],
    workbook: {
      ok: false,
      status: null,
      rowCount: 0,
      sourceEndpoint: null,
    },
    warning: error instanceof Error ? error.message : String(error),
  };
}
