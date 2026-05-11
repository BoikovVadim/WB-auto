import type {
  SellerAnalyticsDownloadListItem,
  SellerAnalyticsReportCandidate,
} from "./monthly-frequency-analytics.types";

export function buildMonthlyFrequencyReportCandidates(period: {
  from: string;
  to: string;
  timezone: string;
}): SellerAnalyticsReportCandidate[] {
  const reportSuffix = `${period.from}-${period.to}`;
  const searchReportPeriod = {
    currentPeriod: {
      start: period.from,
      end: period.to,
    },
    pastPeriod: {
      start: period.from,
      end: period.to,
    },
  };

  return [
    {
      reportType: "SEARCH_QUERIES_PREMIUM_REPORT_TEXT",
      reportName: `wb-monthly-frequency-text-search-report-${reportSuffix}`,
      params: {
        ...searchReportPeriod,
        nmIds: [],
        topOrderBy: "openCard",
        includeSubstitutedSKUs: true,
        includeSearchTexts: true,
        orderBy: {
          field: "avgPosition",
          mode: "asc",
        },
        limit: 100,
      },
    },
    {
      reportType: "SEARCH_QUERIES_PREMIUM_REPORT_PRODUCT",
      reportName: `wb-monthly-frequency-product-search-report-${reportSuffix}`,
      params: {
        ...searchReportPeriod,
        nmIds: [],
        subjectIds: [],
        brandNames: [],
        tagIds: [],
        positionCluster: "all",
        includeSubstitutedSKUs: true,
        includeSearchTexts: true,
        orderBy: {
          field: "avgPosition",
          mode: "asc",
        },
        limit: 100,
        offset: 0,
      },
    },
    {
      reportType: "SEARCH_QUERIES_PREMIUM_REPORT_TEXT",
      reportName: `wb-monthly-frequency-text-${reportSuffix}`,
      params: {
        startDate: period.from,
        endDate: period.to,
        timezone: period.timezone,
      },
    },
    {
      reportType: "SEARCH_QUERIES_PREMIUM_REPORT_TEXT",
      reportName: `wb-monthly-frequency-text-nmids-${reportSuffix}`,
      params: {
        startDate: period.from,
        endDate: period.to,
        timezone: period.timezone,
        nmIDs: [],
        skipDeletedNm: false,
      },
    },
    {
      reportType: "SEARCH_QUERIES_PREMIUM_REPORT_PRODUCT",
      reportName: `wb-monthly-frequency-product-${reportSuffix}`,
      params: {
        startDate: period.from,
        endDate: period.to,
        timezone: period.timezone,
        nmIDs: [],
        includeSearchTexts: true,
        includeSubstitutedSKUs: true,
        skipDeletedNm: false,
      },
    },
  ];
}

export function buildFreePortalMonthlyFrequencyReportName(input: {
  from: string;
  to: string;
  randomSuffix: string;
}) {
  return `wb-free-search-analytics-${input.from}-${input.to}-${input.randomSuffix}`;
}

export function toSellerAnalyticsDownloadItem(
  value: unknown,
  input: {
    readOptionalString: (value: unknown) => string | null;
    toNullableNumber: (value: unknown) => number | null;
  },
): SellerAnalyticsDownloadListItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  const id = input.readOptionalString(item.id);
  const status = input.readOptionalString(item.status);
  if (!id || !status) {
    return null;
  }

  return {
    id,
    status,
    name: input.readOptionalString(item.name),
    createdAt: input.readOptionalString(item.createdAt),
    startDate: input.readOptionalString(item.startDate),
    endDate: input.readOptionalString(item.endDate),
    size: input.toNullableNumber(item.size),
  };
}

export function findMatchingSellerAnalyticsReport(
  reports: SellerAnalyticsDownloadListItem[],
  reportName: string,
  period: { from: string; to: string },
) {
  return (
    reports
      .filter(
        (item) =>
          item.name === reportName &&
          item.startDate === period.from &&
          item.endDate === period.to,
      )
      .sort((left, right) =>
        (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
      )[0] ?? null
  );
}
