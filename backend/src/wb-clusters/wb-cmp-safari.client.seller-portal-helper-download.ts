export function buildSellerPortalHelperDownloadScript() {
  return `
      function prepareExport(reportName) {
        var rootScope = activeDialog();
        var trigger =
          document.querySelector('[data-testid="Download-manager-open-modal-button-interface"]') ||
          findBestClickable([["excel"], ["xlsx"], ["выгруз"], ["экспорт"], ["скач"]], rootScope) ||
          findBestClickable([["создать", "отчет"], ["создать", "отч"], ["create", "report"]], rootScope);
        if (!trigger && rootScope !== document) {
          trigger =
            document.querySelector('[data-testid="Download-manager-open-modal-button-interface"]') ||
            findBestClickable([["excel"], ["xlsx"], ["выгруз"], ["экспорт"], ["скач"]], document) ||
            findBestClickable([["создать", "отчет"], ["создать", "отч"], ["create", "report"]], document);
        }
        if (!trigger) {
          return createResult({
            error:
              "Could not find the seller-portal export button for the free XLSX report.",
            fatal: true,
            step: "open-export",
          });
        }

        clickNode(trigger);
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

      function openDownloads() {
        var button =
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
        prepareExport: prepareExport,
        openDownloads: openDownloads,
        tryDownloadReport: tryDownloadReport,
      };

      return true;
    })();
`;
}
