/**
 * WB Content Analytics API client.
 *
 * Provides helpers to call seller-content.wildberries.ru API via async XHR
 * injected into an open Safari seller portal tab (AppleScript bridge).
 *
 * Discovered endpoints:
 *   POST /ns/analytics-api/content-analytics/api/v1/file-manager/download  → create report
 *   GET  /ns/analytics-api/content-analytics/api/v1/file-manager/downloads → poll status
 *   navigation to downloadUrl (browser context)                            → download file
 *
 * Auth: `AuthorizeV3` header from Safari localStorage + browser httpOnly cookies (withCredentials).
 */

import { randomUUID } from "node:crypto";

export const WB_CONTENT_ANALYTICS_BASE =
  "https://seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v1";
export const WB_CONTENT_ANALYTICS_CREATE_URL = `${WB_CONTENT_ANALYTICS_BASE}/file-manager/download`;
export const WB_CONTENT_ANALYTICS_LIST_URL = `${WB_CONTENT_ANALYTICS_BASE}/file-manager/downloads`;

export type ContentAnalyticsReportType =
  | "SEARCH_ANALYSIS_PREMIUM_REPORT"
  | "SEARCH_ANALYSIS_FREE_REPORT";

export interface ContentAnalyticsDownloadEntry {
  id: string;
  createdAt: string;
  generatedAt: string | null;
  status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | string;
  name: string;
  size: number;
  startDate: string;
  endDate: string;
  downloadUrl: string;
}

export interface ContentAnalyticsListResponse {
  error: boolean;
  errorText: string;
  data: { downloads: ContentAnalyticsDownloadEntry[] } | null;
}

/** Generates a random UUID for use as a report ID. */
export function generateReportId(): string {
  return randomUUID();
}

/** Builds the list URL for polling a specific report type. */
export function buildListUrl(reportType: ContentAnalyticsReportType): string {
  return `${WB_CONTENT_ANALYTICS_LIST_URL}?report_types=${encodeURIComponent(reportType)}`;
}

/** Builds the POST body for creating a search analytics report.
 *
 * When `subjectIds` is provided (non-empty), the report is filtered to those
 * WB subject categories only — yielding ALL queries for those subjects without
 * the global 300k frequency cutoff. Pass our full list of product subjects so
 * every cluster in every category gets accurate frequency data.
 */
export function buildCreateReportBody(input: {
  reportId: string;
  reportType: ContentAnalyticsReportType;
  subjectIds?: number[];
  /** Sort order for frequency. "desc" = highest first (default), "asc" = lowest first. */
  orderByMode?: "asc" | "desc";
}): string {
  return JSON.stringify({
    id: input.reportId,
    userReportName: "",
    reportType: input.reportType,
    params: {
      items: [],
      subjectIDs: input.subjectIds ?? [],
      searchText: "",
      cartToOrder: [],
      openToCart: [],
      interval: "month",
      orderBy: { field: "frequency", mode: input.orderByMode ?? "desc" },
      limit: 300_000,
    },
  });
}

/**
 * Builds an AppleScript that fires an async XHR in the open seller portal tab,
 * polls until the XHR completes, then returns the result as JSON.
 *
 * Uses `set jsCode to ${JSON.stringify(...)}` to safely embed JS without escaping issues.
 */
export function buildAsyncXhrAppleScript(input: {
  method: "GET" | "POST";
  url: string;
  body?: string;
  pollSeconds?: number;
}): string {
  const pollSeconds = input.pollSeconds ?? 30;
  const bodyArg = input.body ? JSON.stringify(input.body) : "null";

  // JavaScript to inject - stored as AppleScript variable to avoid string escaping
  const jsCode = `(function(){
    window.__caXhrResult = null;
    var av3 = localStorage.getItem('wb-eu-passport-v2.access-token') || '';
    var xhr = new XMLHttpRequest();
    xhr.open(${JSON.stringify(input.method)}, ${JSON.stringify(input.url)}, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-type', 'application/json');
    if (av3) xhr.setRequestHeader('AuthorizeV3', av3);
    xhr.onload = function() {
      window.__caXhrResult = JSON.stringify({s: xhr.status, b: xhr.responseText});
    };
    xhr.onerror = function() {
      window.__caXhrResult = JSON.stringify({s: 0, b: '', e: 'network_error'});
    };
    xhr.send(${bodyArg});
    return 'fired';
  })()`;

  return `
tell application "Safari"
  set myTab to null
  repeat with w in windows
    repeat with tr in tabs of w
      try
        set tUrl to URL of tr
        if tUrl contains "seller.wildberries.ru" then
          set btnC to do JavaScript "document.querySelectorAll('button').length" in tr
          try
            if (btnC as integer) > 10 then
              set myTab to tr
              exit repeat
            end if
          on error
          end try
        end if
      on error
      end try
    end repeat
    if myTab is not null then exit repeat
  end repeat
  if myTab is null then
    return "{\\"s\\":0,\\"b\\":\\"\\",\\"e\\":\\"no-portal-tab-found\\"}"
  end if

  -- Fire the async XHR
  set jsCode to ${JSON.stringify(jsCode)}
  do JavaScript jsCode in myTab

  -- Poll until result is available (up to ${pollSeconds} seconds)
  -- Wrap in try/on error: if the tab navigated, do JavaScript may throw -2753
  -- The JS returns null (not undefined) so AppleScript gets missing value safely
  set resultJson to "null"
  repeat ${pollSeconds} times
    delay 1
    try
      set checkRes to do JavaScript "(function(){var v=window.__caXhrResult;return(typeof v==='string'?v:null);})()" in myTab
      if checkRes is not missing value and checkRes is not "" and checkRes is not "null" then
        set resultJson to checkRes
        exit repeat
      end if
    on error
      -- tab may have reloaded; keep waiting
    end try
  end repeat

  return resultJson
end tell
  `.trim();
}

/** Parses the JSON result string from buildAsyncXhrAppleScript. */
export function parseXhrResult(raw: string): {
  status: number;
  body: string;
  error: string | null;
} {
  if (!raw || raw === "null") {
    return { status: 0, body: "", error: "XHR timed out — no result received" };
  }

  try {
    const parsed = JSON.parse(raw) as {
      s: number | null;
      b: string | null;
      e?: string | null;
    };
    return {
      status: parsed.s ?? 0,
      body: parsed.b ?? "",
      error: parsed.e ?? null,
    };
  } catch {
    return { status: 0, body: raw, error: `Failed to parse XHR result: ${raw.slice(0, 200)}` };
  }
}

/**
 * Builds an AppleScript that triggers a browser download via anchor click
 * in the open seller portal tab. The browser's httpOnly session cookies are
 * sent automatically (needed for downloads-content-analytics.wildberries.ru).
 */
export function buildDownloadTriggerAppleScript(downloadUrl: string): string {
  const jsCode = `(function(){
    var a = document.createElement('a');
    a.href = ${JSON.stringify(downloadUrl)};
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return 'download-anchor-clicked';
  })()`;

  return `
tell application "Safari"
  set myTab to null
  repeat with w in windows
    repeat with tr in tabs of w
      try
        set tUrl to URL of tr
        if tUrl contains "seller.wildberries.ru" then
          set btnC to do JavaScript "document.querySelectorAll('button').length" in tr
          try
            if (btnC as integer) > 10 then
              set myTab to tr
              exit repeat
            end if
          on error
          end try
        end if
      on error
      end try
    end repeat
    if myTab is not null then exit repeat
  end repeat
  if myTab is null then
    return "error: no-portal-tab"
  end if

  set jsCode to ${JSON.stringify(jsCode)}
  set result to do JavaScript jsCode in myTab
  return result
end tell
  `.trim();
}
