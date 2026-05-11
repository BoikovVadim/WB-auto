import { randomUUID } from "node:crypto";

import {
  buildFreePortalMonthlyFrequencyReportName,
  parseMonthlyFrequencyWorkbookBuffer,
} from "./monthly-frequency-analytics.ingest";

type WbClustersService = any;

export async function syncFreePortalMonthlyFrequencyReport(
  self: WbClustersService,
  input: {
    syncRunId: string;
    nmId: number | null;
    period: { from: string; to: string; timezone: string };
    warningMessages: string[];
  },
) {
  const reportName = buildFreePortalMonthlyFrequencyReportName({
    from: input.period.from,
    to: input.period.to,
    randomSuffix: randomUUID().slice(0, 8),
  });
  const downloadedReport = await self.tryCmpStep(
    `seller portal free search analytics XLSX for ${input.period.from}..${input.period.to}`,
    () =>
      self.wbCmpSafariClient.exportFreeSearchAnalyticsReport({
        periodFrom: input.period.from,
        periodTo: input.period.to,
        reportName,
      }),
    input.warningMessages,
  );
  if (!downloadedReport) {
    return false;
  }

  for (const warning of downloadedReport.warnings ?? []) {
    self.pushWarning(input.warningMessages, `seller portal free search analytics warning: ${warning}`);
  }

  const rows = parseMonthlyFrequencyWorkbookBuffer({
    workbookBuffer: downloadedReport.workbookBuffer,
    readOptionalString: (value) => self.readOptionalString(value),
    normalizeAdvertisingText: (value) => self.normalizeAdvertisingText(value),
  });
  if (rows.length === 0) {
    self.pushWarning(
      input.warningMessages,
      `WB seller portal report ${reportName} was downloaded, but monthly frequency rows could not be parsed from the XLSX headers.`,
    );
    return false;
  }

  const rowsUpserted = await self.wbClustersRepository.replaceMonthlyQueryFrequencies({
    reportType: "FREE_SEARCH_ANALYTICS_PORTAL_XLSX",
    reportId: reportName,
    downloadId: downloadedReport.downloadedFileName,
    reportStartDate: input.period.from,
    reportEndDate: input.period.to,
    rows,
  });

  await self.wbClustersRepository.saveRawArchive({
    syncRunId: input.syncRunId,
    archiveType: "seller-analytics-free-portal-file",
    advertId: null,
    nmId: input.nmId,
    payload: {
      reportId: reportName,
      reportType: "FREE_SEARCH_ANALYTICS_PORTAL_XLSX",
      reportName,
      downloadedFileName: downloadedReport.downloadedFileName,
      downloadedFilePath: downloadedReport.downloadedFilePath,
      downloadedAt: downloadedReport.downloadedAt,
      period: input.period,
      rowsUpserted,
      sample: rows.slice(0, 25),
      warnings: downloadedReport.warnings ?? [],
    },
  });

  return true;
}
