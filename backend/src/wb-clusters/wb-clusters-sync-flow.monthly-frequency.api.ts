import { toSellerAnalyticsDownloadItem } from "./monthly-frequency-analytics.ingest";

type WbClustersService = any;

export async function getSellerAnalyticsReportList(self: WbClustersService) {
  const response = await self.wbApiClient.request({
    method: "GET",
    path: "/api/v2/nm-report/downloads",
  });

  const rawItems =
    response && typeof response === "object" && "data" in response ? response.data : null;

  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems
    .map((item) =>
      toSellerAnalyticsDownloadItem(item, {
        readOptionalString: (value) => self.readOptionalString(value),
        toNullableNumber: (value) => self.toNullableNumber(value),
      }),
    )
    .filter((item) => item !== null && item.name !== null);
}

export async function createSellerAnalyticsReport(
  self: WbClustersService,
  input: {
    reportId: string;
    candidate: any;
  },
) {
  return self.wbApiClient.request({
    method: "POST",
    path: "/api/v2/nm-report/downloads",
    body: {
      id: input.reportId,
      reportType: input.candidate.reportType,
      userReportName: input.candidate.reportName,
      params: input.candidate.params,
    },
  });
}

export async function retrySellerAnalyticsReport(
  self: WbClustersService,
  reportId: string,
) {
  return self.wbApiClient.request({
    method: "POST",
    path: "/api/v2/nm-report/downloads/retry",
    body: {
      downloadId: reportId,
    },
  });
}

export async function getSellerAnalyticsReportFile(
  self: WbClustersService,
  reportId: string,
) {
  return self.wbApiClient.requestBuffer({
    method: "GET",
    path: `/api/v2/nm-report/downloads/file/${encodeURIComponent(reportId)}`,
  });
}
