export function buildSellerPortalHelperCoreScript() {
  return `
    (function () {
      var warningMessages = [];

      function normalize(value) {
        return String(value || "")
          .toLowerCase()
          .replace(/\\s+/g, " ")
          .trim();
      }

      function createResult(extra) {
        var result = Object.assign({ ok: false }, extra || {});
        if (Array.isArray(result.warnings)) {
          warningMessages = warningMessages.concat(
            result.warnings.filter(function (item) {
              return typeof item === "string" && item.trim().length > 0;
            }),
          );
        }
        result.warnings = warningMessages.slice();
        return JSON.stringify(result);
      }

      function isVisible(node) {
        if (!node || !(node instanceof Element)) {
          return false;
        }
        var style = window.getComputedStyle(node);
        if (!style || style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        var rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function readText(node) {
        if (!node || !(node instanceof Element)) {
          return "";
        }
        var parts = [
          node.textContent || "",
          node.getAttribute("aria-label") || "",
          node.getAttribute("title") || "",
          node.getAttribute("placeholder") || "",
          node.getAttribute("data-tooltip") || "",
          node.getAttribute("name") || "",
          node.getAttribute("value") || "",
        ];
        return normalize(parts.join(" "));
      }

      function matchesTokens(node, tokenGroups) {
        var text = readText(node);
        if (!text) {
          return false;
        }
        return tokenGroups.some(function (group) {
          return group.every(function (token) {
            return text.indexOf(token) !== -1;
          });
        });
      }

      function clickableNodes(scope) {
        return Array.from(
          (scope || document).querySelectorAll(
            'button, [role="button"], a, label, div, span, input[type="button"], input[type="submit"]',
          ),
        ).filter(isVisible);
      }

      function clickNode(node) {
        if (!node) {
          return false;
        }
        ["mouseover", "mousedown", "mouseup", "click"].forEach(function (eventName) {
          node.dispatchEvent(
            new MouseEvent(eventName, {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
        });
        if (typeof node.click === "function") {
          node.click();
        }
        return true;
      }

      function findBestClickable(tokenGroups, scope) {
        var nodes = clickableNodes(scope).filter(function (node) {
          return matchesTokens(node, tokenGroups);
        });
        return nodes[0] || null;
      }

      function setNativeValue(input, value) {
        if (!input) {
          return false;
        }
        var prototype = Object.getPrototypeOf(input);
        var descriptor = prototype
          ? Object.getOwnPropertyDescriptor(prototype, "value")
          : null;
        if (descriptor && typeof descriptor.set === "function") {
          descriptor.set.call(input, value);
        } else {
          input.value = value;
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("blur", { bubbles: true }));
        return true;
      }

      function visibleInputs() {
        return Array.from(document.querySelectorAll("input, textarea")).filter(function (node) {
          return isVisible(node) && !node.disabled && node.type !== "hidden";
        });
      }

      function ensureSession() {
        if (!document.body) {
          return createResult({
            error: "Seller portal page did not finish loading in Safari.",
            fatal: true,
            step: "page-load",
          });
        }
        var bodyText = normalize(document.body.textContent || "");
        if (bodyText.indexOf("войти") !== -1 && bodyText.indexOf("поисковые запросы") === -1) {
          return createResult({
            error: "Missing WB seller session in Safari. Open the seller portal in Safari first.",
            fatal: true,
            step: "session",
          });
        }
        return createResult({ ok: true, step: "session" });
      }

      function configurePeriod(startDateValue, endDateValue) {
        var presetButton = findBestClickable(
          [["30 дней"], ["последние", "30"], ["30", "дней"], ["месяц"], ["month"]],
          document,
        );
        if (presetButton) {
          clickNode(presetButton);
        }

        var dateInputs = visibleInputs().filter(function (node) {
          var type = normalize(node.getAttribute("type") || "");
          var text = readText(node);
          return (
            type === "date" ||
            text.indexOf("дата") !== -1 ||
            text.indexOf("period") !== -1 ||
            /^\\d{2}\\.\\d{2}\\.\\d{4}$/.test(String(node.value || ""))
          );
        });

        if (dateInputs.length >= 2) {
          setNativeValue(dateInputs[0], startDateValue);
          setNativeValue(dateInputs[1], endDateValue);
          var applyButton = findBestClickable(
            [["применить"], ["показать"], ["готово"], ["apply"]],
            document,
          );
          if (applyButton) {
            clickNode(applyButton);
          }
          return createResult({
            ok: true,
            step: "period",
            warnings: presetButton ? ["Used heuristic date inputs after clicking 30-day preset."] : [],
          });
        }

        if (presetButton) {
          return createResult({
            ok: true,
            step: "period",
            warnings: ["Used 30-day preset; seller portal may still need manual date confirmation."],
          });
        }

        return createResult({
          error:
            "Could not find seller-portal period controls for the free search analytics export.",
          fatal: true,
          step: "period",
        });
      }

      function activeDialog() {
        var dialog =
          Array.from(document.querySelectorAll('[role="dialog"], .ant-modal, .ReactModalPortal'))
            .filter(isVisible)[0] || null;
        return dialog || document;
      }
`;
}
