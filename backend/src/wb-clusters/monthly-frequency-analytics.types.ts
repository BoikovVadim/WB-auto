export type MonthlyFrequencyRow = {
  queryText: string;
  monthlyFrequency: number;
};

export interface SellerAnalyticsReportCandidate {
  reportType: string;
  reportName: string;
  params: Record<string, unknown>;
}

export interface SellerAnalyticsDownloadListItem {
  id: string;
  status: string;
  name: string | null;
  createdAt: string | null;
  startDate: string | null;
  endDate: string | null;
  size: number | null;
}
