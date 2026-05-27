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

    -- ╔═══════════════════════════════════════════════════════╗
    -- ║  PHASE 1 — Submit the report creation request         ║
    -- ╚═══════════════════════════════════════════════════════╝
    tell application "Safari"
      make new document with properties {URL:targetUrl}
      delay 0.5
      set submitWindow to front window

      -- Wait for page readyState=complete and correct URL.
      repeat 320 times
        try
          set pageState to do JavaScript "JSON.stringify({href: location.href, readyState: document.readyState})" in current tab of submitWindow
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
          set currentHref to do JavaScript "location.href" in current tab of submitWindow
          if currentHref contains "seller.wildberries.ru/search-analytics/popular-search-queries" then
            exit repeat
          end if
        on error
        end try
        delay 0.25
      end repeat

      -- Wait for 20+ buttons (analytics content is fully rendered).
      repeat 120 times
        try
          set buttonCount to do JavaScript "document.querySelectorAll('button').length" in current tab of submitWindow
          try
            if (buttonCount as integer) >= 20 then
              exit repeat
            end if
          on error
          end try
        on error
        end try
        delay 0.5
      end repeat

      do JavaScript helperScript in current tab of submitWindow
      set sessionPayload to do JavaScript "window.__wbSellerPortalExport.ensureSession()" in current tab of submitWindow
      if sessionPayload does not contain "\\"ok\\":true" then
        set fallbackPayload to sessionPayload
        try
          close submitWindow
        end try
        return fallbackPayload
      end if

      set periodPayload to do JavaScript "window.__wbSellerPortalExport.configurePeriod(" & quoted form of startDateValue & "," & quoted form of endDateValue & ")" in current tab of submitWindow
      if periodPayload does not contain "\\"ok\\":true" then
        set fallbackPayload to periodPayload
        try
          close submitWindow
        end try
        return fallbackPayload
      end if

      -- Open the downloads panel (retry up to 20 s after SPA re-render from period click).
      set downloadsPayload to "{\\"ok\\":false}"
      repeat 20 times
        do JavaScript helperScript in current tab of submitWindow
        set downloadsPayload to do JavaScript "window.__wbSellerPortalExport.openDownloads()" in current tab of submitWindow
        if downloadsPayload contains "\\"ok\\":true" then
          exit repeat
        end if
        delay 1
      end repeat
      if downloadsPayload does not contain "\\"ok\\":true" then
        set fallbackPayload to downloadsPayload
        try
          close submitWindow
        end try
        return fallbackPayload
      end if

      -- Wait for skeleton, then capture baseline button count.
      delay 5
      do JavaScript helperScript in current tab of submitWindow
      do JavaScript "window.__wbSellerPortalExport.captureDownloadBaseline()" in current tab of submitWindow

      -- Open the "Create Excel" modal.
      set openModalPayload to do JavaScript "window.__wbSellerPortalExport.openExportModal()" in current tab of submitWindow
      if openModalPayload does not contain "\\"ok\\":true" then
        set fallbackPayload to openModalPayload
        try
          close submitWindow
        end try
        return fallbackPayload
      end if

      -- Wait for modal to render, then fill and submit.
      delay 2
      set exportPayload to do JavaScript "window.__wbSellerPortalExport.fillExportForm(" & quoted form of reportName & ")" in current tab of submitWindow
      if exportPayload does not contain "\\"ok\\":true" then
        set fallbackPayload to exportPayload
        try
          close submitWindow
        end try
        return fallbackPayload
      end if

      -- Close the submit tab — a fresh tab with fresh token will be used for downloading.
      delay 2
      try
        close submitWindow
      end try
    end tell

    -- ╔═══════════════════════════════════════════════════════╗
    -- ║  WAIT — Give WB 8 minutes to generate the report     ║
    -- ╚═══════════════════════════════════════════════════════╝
    delay 480

    -- ╔═══════════════════════════════════════════════════════╗
    -- ║  PHASE 2 — Fresh tab, valid token, click download     ║
    -- ╚═══════════════════════════════════════════════════════╝
    tell application "Safari"
      make new document with properties {URL:targetUrl}
      delay 0.5
      set downloadWindow to front window

      -- Wait for page load.
      repeat 320 times
        try
          set pageState to do JavaScript "JSON.stringify({href: location.href, readyState: document.readyState})" in current tab of downloadWindow
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

      -- Wait for 20+ buttons.
      repeat 120 times
        try
          set buttonCount to do JavaScript "document.querySelectorAll('button').length" in current tab of downloadWindow
          try
            if (buttonCount as integer) >= 20 then
              exit repeat
            end if
          on error
          end try
        on error
        end try
        delay 0.5
      end repeat

      do JavaScript helperScript in current tab of downloadWindow

      -- Open the downloads panel (retry up to 20 s).
      set downloadsPayload to "{\\"ok\\":false}"
      repeat 20 times
        do JavaScript helperScript in current tab of downloadWindow
        set downloadsPayload to do JavaScript "window.__wbSellerPortalExport.openDownloads()" in current tab of downloadWindow
        if downloadsPayload contains "\\"ok\\":true" then
          exit repeat
        end if
        delay 1
      end repeat
      if downloadsPayload does not contain "\\"ok\\":true" then
        set fallbackPayload to downloadsPayload
        try
          close downloadWindow
        end try
        return fallbackPayload
      end if

      -- Poll until the newest ready entry appears and click its download button.
      repeat 120 times
        do JavaScript helperScript in current tab of downloadWindow
        set downloadPayload to do JavaScript "window.__wbSellerPortalExport.tryDownloadFirstReady()" in current tab of downloadWindow
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
        close downloadWindow
      end try

      return fallbackPayload
    end tell
  `;
}
