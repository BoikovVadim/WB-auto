interface SellerPortalExportAppleScriptInput {
  helperScript: string;
  reportName: string;
  startDateRu: string;
  endDateRu: string;
}

export function buildSellerPortalExportAppleScript(
  input: SellerPortalExportAppleScriptInput,
) {
  return `
    set targetUrl to "https://seller.wildberries.ru/search-analytics/popular-search-queries"
    set helperScript to ${JSON.stringify(input.helperScript)}
    set reportName to ${JSON.stringify(input.reportName)}
    set startDateValue to ${JSON.stringify(input.startDateRu)}
    set endDateValue to ${JSON.stringify(input.endDateRu)}
    set fallbackPayload to "{\\"ok\\":false,\\"fatal\\":true,\\"error\\":\\"Unknown seller portal export state.\\"}"

    tell application "Safari"
      make new document with properties {URL:targetUrl}
      delay 0.5
      set targetWindow to front window

      repeat 320 times
        try
          set pageState to do JavaScript "JSON.stringify({href: location.href, readyState: document.readyState})" in current tab of targetWindow
          if pageState is not "" then
            set hrefReady to pageState contains "seller.wildberries.ru/search-analytics/popular-search-queries"
            set loadReady to pageState contains "\\"readyState\\":\\"complete\\""
            if hrefReady and loadReady then
              exit repeat
            end if
          end if
        on error
        end try
        delay 0.25
      end repeat

      repeat 20 times
        try
          set currentHref to do JavaScript "location.href" in current tab of targetWindow
          if currentHref contains "seller.wildberries.ru/search-analytics/popular-search-queries" then
            exit repeat
          end if
        on error
        end try
        delay 0.25
      end repeat

      do JavaScript helperScript in current tab of targetWindow
      set sessionPayload to do JavaScript "window.__wbSellerPortalExport.ensureSession()" in current tab of targetWindow
      if sessionPayload does not contain "\\"ok\\":true" then
        set fallbackPayload to sessionPayload
        try
          close targetWindow
        end try
        return fallbackPayload
      end if

      set periodPayload to do JavaScript "window.__wbSellerPortalExport.configurePeriod(" & quoted form of startDateValue & "," & quoted form of endDateValue & ")" in current tab of targetWindow
      if periodPayload does not contain "\\"ok\\":true" then
        set fallbackPayload to periodPayload
        try
          close targetWindow
        end try
        return fallbackPayload
      end if

      set exportPayload to do JavaScript "window.__wbSellerPortalExport.prepareExport(" & quoted form of reportName & ")" in current tab of targetWindow
      if exportPayload does not contain "\\"ok\\":true" then
        set fallbackPayload to exportPayload
        try
          close targetWindow
        end try
        return fallbackPayload
      end if

      set downloadsPayload to do JavaScript "window.__wbSellerPortalExport.openDownloads()" in current tab of targetWindow
      if downloadsPayload does not contain "\\"ok\\":true" then
        set fallbackPayload to downloadsPayload
        try
          close targetWindow
        end try
        return fallbackPayload
      end if

      repeat 300 times
        set downloadPayload to do JavaScript "window.__wbSellerPortalExport.tryDownloadReport(" & quoted form of reportName & ")" in current tab of targetWindow
        if downloadPayload contains "\\"downloadRequested\\":true" then
          set fallbackPayload to downloadPayload
          exit repeat
        end if
        if downloadPayload contains "\\"fatal\\":true" then
          set fallbackPayload to downloadPayload
          exit repeat
        end if
        set fallbackPayload to downloadPayload
        delay 1
      end repeat

      try
        close targetWindow
      end try

      return fallbackPayload
    end tell
  `;
}
