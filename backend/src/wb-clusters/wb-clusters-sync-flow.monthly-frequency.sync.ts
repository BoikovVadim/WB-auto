import { randomUUID } from "node:crypto";

import {
  buildMonthlyFrequencyReportCandidates,
  extractCsvBufferFromZip,
  findMatchingSellerAnalyticsReport,
  parseMonthlyFrequencyCsv,
} from "./monthly-frequency-analytics.ingest";
import {
  createSellerAnalyticsReport,
  getSellerAnalyticsReportFile,
  getSellerAnalyticsReportList,
  retrySellerAnalyticsReport,
} from "./wb-clusters-sync-flow.monthly-frequency.api";
import { syncFreePortalMonthlyFrequencyReport } from "./wb-clusters-sync-flow.monthly-frequency.portal";
import type {
  SellerAnalyticsDownloadListItem,
  SellerAnalyticsReportCandidate,
} from "./monthly-frequency-analytics.ingest";

type WbClustersService = any;

export async function syncMonthlyFrequencyReadModel(
  self: WbClustersService,
  input: {
    syncRunId: string;
    nmId: number | null;
    warningMessages: string[];
  },
) {
  const period = self.getMonthlyFrequencyPeriod();
  const latestSnapshot = await self.wbClustersRepository.getLatestMonthlyQueryFrequencySnapshot();

  if (latestSnapshot?.reportEndDate === period.to) {
    return;
  }

  if (self.wbRuntimeConfigService.getTokenSource() === "missing") {
    self.pushWarning(
      input.warningMessages,
      "Monthly frequency premium reports were skipped because WB Analytics token is missing.",
    );
  } else {
    for (const candidate of buildMonthlyFrequencyReportCandidates(period)) {
      const candidateResult = await self.trySyncMonthlyFrequencyCandidate({
        syncRunId: input.syncRunId,
        nmId: input.nmId,
        period,
        candidate,
        warningMessages: input.warningMessages,
      });
      if (candidateResult !== "continue") {
        break;
      }
    }
  }

  const refreshedSnapshot = await self.wbClustersRepository.getLatestMonthlyQueryFrequencySnapshot();
  if (refreshedSnapshot?.reportEndDate === period.to) {
    return;
  }

  if (!self.wbCmpSafariClient.isAvailable()) {
    self.pushWarning(
      input.warningMessages,
      `Monthly frequency premium snapshot for ${period.to} is still missing, and the Safari seller-portal fallback is unavailable on this host.`,
    );
    return;
  }

  await self.syncFreePortalMonthlyFrequencyReport({
    syncRunId: input.syncRunId,
    nmId: input.nmId,
    period,
    warningMessages: input.warningMessages,
  });
}

export async function trySyncMonthlyFrequencyCandidate(
  self: WbClustersService,
  input: {
    syncRunId: string;
    nmId: number | null;
    period: { from: string; to: string; timezone: string };
    candidate: SellerAnalyticsReportCandidate;
    warningMessages: string[];
  },
) {
  const initialList: SellerAnalyticsDownloadListItem[] | null = await self.tryAnalyticsStep(
    `seller analytics report list for ${input.candidate.reportType}`,
    () => getSellerAnalyticsReportList(self),
    input.warningMessages,
  );
  if (!initialList) {
    return "done";
  }

  await self.wbClustersRepository.saveRawArchive({
    syncRunId: input.syncRunId,
    archiveType: "seller-analytics-downloads-list",
    advertId: null,
    nmId: input.nmId,
    payload: {
      candidate: input.candidate.reportType,
      reportName: input.candidate.reportName,
        reports: initialList.filter((item: any) => item.name === input.candidate.reportName),
    },
  });

  const readyExistingReport = findMatchingSellerAnalyticsReport(
    initialList,
    input.candidate.reportName,
    input.period,
  );
  if (readyExistingReport?.status === "SUCCESS") {
    const downloaded = await self.downloadMonthlyFrequencyReport({
      syncRunId: input.syncRunId,
      nmId: input.nmId,
      reportId: readyExistingReport.id,
      candidate: input.candidate,
      period: input.period,
      warningMessages: input.warningMessages,
    });
    return downloaded ? "done" : "continue";
  }

  if (readyExistingReport) {
    if (readyExistingReport.status !== "FAILED") {
      self.pushWarning(
        input.warningMessages,
        `WB Seller Analytics already has ${readyExistingReport.status} report ${readyExistingReport.id} for ${input.period.from}..${input.period.to}. Monthly frequency will use the previous cached snapshot until that report becomes available.`,
      );
      return "done";
    }

    const retried = await self.tryAnalyticsStep(
      `seller analytics report retry for ${readyExistingReport.id}`,
      () => retrySellerAnalyticsReport(self, readyExistingReport.id),
      input.warningMessages,
    );
    if (retried) {
      await self.wbClustersRepository.saveRawArchive({
        syncRunId: input.syncRunId,
        archiveType: "seller-analytics-downloads-retry",
        advertId: null,
        nmId: input.nmId,
        payload: {
          reportId: readyExistingReport.id,
          reportName: input.candidate.reportName,
          result: retried,
        },
      });
    }
    self.pushWarning(
      input.warningMessages,
      `WB Seller Analytics report ${readyExistingReport.id} was in FAILED state and was sent to retry. Monthly frequency will keep the previous cached snapshot until retry finishes.`,
    );
    return "done";
  }

  const reportId = randomUUID();
  const createResponse = await self.tryAnalyticsStep(
    `seller analytics report create for ${input.candidate.reportType}`,
    () =>
      createSellerAnalyticsReport(self, {
        reportId,
        candidate: input.candidate,
      }),
    input.warningMessages,
  );
  if (!createResponse) {
    return "continue";
  }

  await self.wbClustersRepository.saveRawArchive({
    syncRunId: input.syncRunId,
    archiveType: "seller-analytics-downloads-create",
    advertId: null,
    nmId: input.nmId,
    payload: {
      reportId,
      reportType: input.candidate.reportType,
      reportName: input.candidate.reportName,
      period: input.period,
      params: input.candidate.params,
      result: createResponse,
    },
  });

  const refreshedList: SellerAnalyticsDownloadListItem[] | null = await self.tryAnalyticsStep(
    `seller analytics report post-create list for ${input.candidate.reportType}`,
    () => getSellerAnalyticsReportList(self),
    input.warningMessages,
  );
  if (!refreshedList) {
    return "done";
  }

  const createdReport =
    refreshedList.find((item: any) => item.id === reportId) ??
    findMatchingSellerAnalyticsReport(refreshedList, input.candidate.reportName, input.period);

  if (!createdReport) {
    self.pushWarning(
      input.warningMessages,
      `WB Seller Analytics accepted ${input.candidate.reportType}, but the report is not visible in list yet.`,
    );
    return "done";
  }

  if (createdReport.status === "FAILED") {
    const retried = await self.tryAnalyticsStep(
      `seller analytics report retry for ${createdReport.id}`,
      () => retrySellerAnalyticsReport(self, createdReport.id),
      input.warningMessages,
    );
    if (!retried) {
      return "done";
    }
  }

  if (createdReport.status !== "SUCCESS") {
    self.pushWarning(
      input.warningMessages,
      `WB Seller Analytics report ${createdReport.id} is still ${createdReport.status}. Monthly frequency will stay on the latest cached snapshot until the report is ready.`,
    );
    return "done";
  }

  const downloaded = await self.downloadMonthlyFrequencyReport({
    syncRunId: input.syncRunId,
    nmId: input.nmId,
    reportId: createdReport.id,
    candidate: input.candidate,
    period: input.period,
    warningMessages: input.warningMessages,
  });
  return downloaded ? "done" : "continue";
}

export async function downloadMonthlyFrequencyReport(
  self: WbClustersService,
  input: {
    syncRunId: string;
    nmId: number | null;
    reportId: string;
    candidate: SellerAnalyticsReportCandidate;
    period: { from: string; to: string; timezone: string };
    warningMessages: string[];
  },
) {
  const reportArchive = await self.tryAnalyticsStep(
    `seller analytics report download for ${input.reportId}`,
    () => getSellerAnalyticsReportFile(self, input.reportId),
    input.warningMessages,
  );
  if (!reportArchive) {
    return false;
  }

  const csvBuffer = extractCsvBufferFromZip({
    archiveBuffer: reportArchive,
    onWarn: (message) => self.logger.warn(message),
    describeError: (error) => self.describeError(error),
  });
  if (!csvBuffer) {
    self.pushWarning(
      input.warningMessages,
      `WB Seller Analytics report ${input.reportId} did not contain a CSV file inside the ZIP archive.`,
    );
    return false;
  }

  const rows = parseMonthlyFrequencyCsv({
    csvBuffer,
    readOptionalString: (value) => self.readOptionalString(value),
    normalizeAdvertisingText: (value) => self.normalizeAdvertisingText(value),
  });
  if (rows.length === 0) {
    self.pushWarning(
      input.warningMessages,
      `WB Seller Analytics report ${input.reportId} was downloaded, but monthly frequency rows could not be parsed from the CSV headers.`,
    );
    return false;
  }

  const rowsUpserted = await self.wbClustersRepository.replaceMonthlyQueryFrequencies({
    reportType: input.candidate.reportType,
    reportId: input.reportId,
    downloadId: input.reportId,
    reportStartDate: input.period.from,
    reportEndDate: input.period.to,
    rows,
  });

  await self.wbClustersRepository.saveRawArchive({
    syncRunId: input.syncRunId,
    archiveType: "seller-analytics-downloads-file",
    advertId: null,
    nmId: input.nmId,
    payload: {
      reportId: input.reportId,
      reportType: input.candidate.reportType,
      reportName: input.candidate.reportName,
      period: input.period,
      rowsUpserted,
      sample: rows.slice(0, 25),
    },
  });

  return true;
}

export {
  syncFreePortalMonthlyFrequencyReport,
};
