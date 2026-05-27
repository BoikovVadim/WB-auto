export type MonthlyFrequencyRow = {
  queryText: string;
  monthlyFrequency: number;
  /** Subject name as it appears in the WB analytics XLSX "Предмет" column, if present. */
  subjectName?: string | null;
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
