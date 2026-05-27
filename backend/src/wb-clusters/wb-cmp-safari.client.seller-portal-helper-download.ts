export function buildSellerPortalHelperDownloadScript() {
  return `
      function findDownloadManagerCreateButton() {
        // New WB UI (2026): icon-only button inside Download-manager element.
        var dmEl = document.querySelector('[class*="Download-manager__"]:not([class*="wrapper"]):not([class*="list"])');
        if (dmEl) {
          var btn = dmEl.querySelector('button') || dmEl;
          if (btn && (btn.tagName === 'BUTTON' || btn.getAttribute('role') === 'button')) return btn;
        }
        // Legacy: by testid or by text
        return (
          document.querySelector('[data-testid="Download-manager-open-modal-button-interface"]') ||
          findBestClickable([["excel"], ["xlsx"], ["выгруз"], ["экспорт"], ["скач"]], document) ||
          findBestClickable([["создать", "отчет"], ["создать", "отч"], ["create", "report"]], document)
        );
      }

      // Step 1: click the icon-only button that opens the "Создать Excel" modal.
      function openExportModal() {
        var trigger = findDownloadManagerCreateButton();
        if (!trigger) {
          return createResult({
            error:
              "Could not find the seller-portal export button for the free XLSX report.",
            fatal: true,
            step: "open-export",
          });
        }
        clickNode(trigger);
        return createResult({ ok: true, step: "open-export" });
      }

      // Step 2: inside the now-open modal — select 300k, fill report name, click submit.
      function fillExportForm(reportName) {
        // New WB UI (2026): modal has "100 тыс." / "300 тыс." size options.
        var modal300btn = findBestClickable([["300"]], document);
        if (modal300btn) {
          clickNode(modal300btn);
        }

        var dialogScope = activeDialog();
        var reportNameInput =
          document.querySelector('[data-testid="Create-excel-modal-name-simple-input"] input') ||
          document.querySelector('[data-testid="Create-excel-modal-name-simple-input"] textarea') ||
          visibleInputs().find(function (node) {
            return (
              isVisible(node) &&
              (readText(node).indexOf("назв") !== -1 ||
                readText(node).indexOf("name") !== -1 ||
                normalize(node.type || "") === "text")
            );
          }) || null;

        if (!reportNameInput) {
          return createResult({
            error:
              "Could not find the seller-portal report-name input for the free XLSX report.",
            fatal: true,
            step: "fill-report-name",
          });
        }

        setNativeValue(reportNameInput, reportName);

        var confirmButton =
          document.querySelector('[data-testid="Create-excel-modal-submit-button-primary"]') ||
          findBestClickable(
            [["создать"], ["сформир"], ["выгруз"], ["скач"], ["экспорт"], ["export"]],
            dialogScope,
          ) ||
          findBestClickable(
            [["создать"], ["сформир"], ["выгруз"], ["скач"], ["экспорт"], ["export"]],
            document,
          );
        if (!confirmButton) {
          return createResult({
            error:
              "Could not find the seller-portal export confirmation button for the free XLSX report.",
            fatal: true,
            step: "confirm-export",
          });
        }

        clickNode(confirmButton);
        return createResult({ ok: true, step: "confirm-export" });
      }

      // Legacy alias kept for compatibility.
      function prepareExport(reportName) {
        var openResult = openExportModal();
        if (!openResult || openResult.indexOf('"ok":true') === -1) return openResult;
        return fillExportForm(reportName);
      }

      function openDownloads() {
        // New WB UI (2026): Download-manager-wrapper contains the list-toggle button.
        var wrapper = document.querySelector('[class*="Download-manager-wrapper__sUx"]') ||
                      document.querySelector('[class*="Download-manager-wrapper"]');
        var wrapperBtn = wrapper ? wrapper.querySelector('button') : null;
        var button =
          wrapperBtn ||
          document.querySelector('[data-testid="Download-manager-wrapper-show-list-button-interface"]') ||
          findBestClickable([["загруз"], ["мои", "отчет"], ["отчет"], ["history"], ["downloads"]], document);
        if (!button) {
          return createResult({
            error:
              "Could not find the seller-portal downloads/report-history entry after starting the export.",
            fatal: true,
            step: "open-downloads",
          });
        }
        clickNode(button);
        return createResult({ ok: true, step: "open-downloads" });
      }

      // Capture how many download buttons exist now (call BEFORE submitting the report).
      function captureDownloadBaseline() {
        var list = document.querySelector('[class*="Downloads-list__"]');
        var count = list ? Array.from(list.querySelectorAll('button')).filter(isVisible).length : 0;
        window.__wbDownloadBaseline = count;
        return createResult({ ok: true, step: "capture-baseline", baselineCount: count });
      }

      // Poll after submission — finds a NEW download button that wasn't there before and clicks it.
      // Automatically re-opens the downloads panel if it was closed by SPA re-render.
      function tryDownloadFirstReady() {
        // Check if the downloads panel is open.
        var downloadsWrapper = null;
        var allEls = document.querySelectorAll('*');
        for (var i = 0; i < allEls.length; i++) {
          var cls = allEls[i].className;
          if (typeof cls === 'string' && cls.indexOf('downloads-wrapper') !== -1 && cls.indexOf('manager') !== -1) {
            downloadsWrapper = allEls[i];
            break;
          }
        }
        var panelOpen = !!(downloadsWrapper && downloadsWrapper.getBoundingClientRect().height > 0);

        if (!panelOpen) {
          // Panel is closed — toggle it open and retry next iteration.
          var toggleWrapper =
            document.querySelector('[class*="Download-manager-wrapper__sUx"]') ||
            document.querySelector('[class*="Download-manager-wrapper"]');
          var toggleBtn = toggleWrapper ? toggleWrapper.querySelector('button') : null;
          if (toggleBtn) {
            clickNode(toggleBtn);
            return createResult({ error: "Downloads panel was closed, reopening...", retryable: true, step: "reopen-panel" });
          }
          return createResult({ error: "Downloads panel not visible and no toggle button found.", retryable: true, step: "wait-panel" });
        }

        // Panel is open. Check for loading skeleton.
        var skeleton = null;
        var skEls = document.querySelectorAll('[class*="Downloads-list-skeleton"]');
        for (var j = 0; j < skEls.length; j++) {
          var r = skEls[j].getBoundingClientRect();
          if (r.height > 0) { skeleton = skEls[j]; break; }
        }
        if (skeleton) {
          return createResult({ error: "Downloads list is still loading (skeleton visible).", retryable: true, step: "wait-skeleton" });
        }

        var list = document.querySelector('[class*="Downloads-list__"]');
        if (!list || list.getBoundingClientRect().height === 0) {
          return createResult({ error: "Downloads list element not visible inside panel.", retryable: true, step: "wait-list" });
        }

        var baseline = typeof window.__wbDownloadBaseline === 'number' ? window.__wbDownloadBaseline : 0;
        var btns = Array.from(list.querySelectorAll('button')).filter(isVisible);

        // If baseline was captured (phase 1 flow), wait for a NEW entry.
        // If baseline is 0 (fresh-tab phase 2 flow), just use the first entry.
        if (baseline > 0 && btns.length <= baseline) {
          return createResult({
            error: "No new download entry yet (baseline " + baseline + ", current " + btns.length + ").",
            retryable: true,
            step: "wait-new-entry",
          });
        }

        if (btns.length === 0) {
          return createResult({ error: "Downloads list is empty.", retryable: true, step: "wait-new-entry" });
        }

        // Use the first (newest) button.
        var firstBtn = btns[0];
        var item = firstBtn.parentElement;
        for (var k = 0; k < 5; k++) {
          if (!item || item === list) break;
          var itemText = normalize(item.textContent || '');
          if (itemText.indexOf('долго формируется') !== -1 || itemText.indexOf('формир') !== -1) {
            return createResult({ error: "New report is still being generated on WB servers...", retryable: true, step: "wait-forming" });
          }
          item = item.parentElement;
        }

        clickNode(firstBtn);
        return createResult({ ok: true, downloadRequested: true, step: "download-report" });
      }

      // Legacy: find report by name and click its download control.
      function findReportRow(reportName) {
        var normalizedName = normalize(reportName);
        var nodes = Array.from(document.querySelectorAll("tr, [role='row'], li, div, article")).filter(
          function (node) {
            return isVisible(node) && readText(node).indexOf(normalizedName) !== -1;
          },
        );
        return nodes[0] || null;
      }

      function tryDownloadReport(reportName) {
        var reportRow = findReportRow(reportName);
        if (!reportRow) {
          return createResult({
            error: "Export row is not visible in seller portal downloads yet.",
            retryable: true,
            step: "wait-report-row",
          });
        }

        var rowText = readText(reportRow);
        var downloadTarget =
          Array.from(
            reportRow.querySelectorAll(
              'a[href], button, [role="button"], [aria-label], [title], svg, use',
            ),
          )
            .filter(isVisible)
            .find(function (node) {
              var href = typeof node.getAttribute === "function" ? node.getAttribute("href") || "" : "";
              return (
                matchesTokens(node, [["скач"], ["download"], ["xlsx"], ["excel"]]) ||
                href.indexOf(".xlsx") !== -1
              );
            }) || null;

        if (downloadTarget) {
          clickNode(downloadTarget);
          return createResult({
            ok: true,
            downloadRequested: true,
            step: "download-report",
            downloadHint: reportName,
          });
        }

        if (
          rowText.indexOf("готов") !== -1 ||
          rowText.indexOf("успеш") !== -1 ||
          rowText.indexOf("complete") !== -1 ||
          rowText.indexOf("done") !== -1
        ) {
          return createResult({
            error:
              "Seller portal report looks ready, but the XLSX download control was not found.",
            fatal: true,
            step: "download-report",
          });
        }

        return createResult({
          error: "Seller portal report is still preparing.",
          retryable: true,
          step: "download-report",
        });
      }

      window.__wbSellerPortalExport = {
        ensureSession: ensureSession,
        configurePeriod: configurePeriod,
        openExportModal: openExportModal,
        fillExportForm: fillExportForm,
        prepareExport: prepareExport,
        openDownloads: openDownloads,
        captureDownloadBaseline: captureDownloadBaseline,
        tryDownloadFirstReady: tryDownloadFirstReady,
        tryDownloadReport: tryDownloadReport,
      };

      return true;
    })();
`;
}
