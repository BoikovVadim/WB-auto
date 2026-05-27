import { Injectable, Logger } from "@nestjs/common";
import { chromium, type LaunchOptions } from "playwright";

import { appEnv } from "../common/env";
import { mergeSellerPortalLocalStorage } from "./wb-cabinet-private-api.storage-state";
import { formatIsoDateForRuInput } from "./wb-cmp-safari.client.downloads";
import { buildSellerPortalHelperCoreScript } from "./wb-cmp-safari.client.seller-portal-helper-core";
import { buildSellerPortalHelperDownloadScript } from "./wb-cmp-safari.client.seller-portal-helper-download";

const SELLER_PORTAL_ANALYTICS_URL =
  "https://seller.wildberries.ru/search-analytics/popular-search-queries";

function buildHelperScript(): string {
  return [buildSellerPortalHelperCoreScript(), buildSellerPortalHelperDownloadScript()].join("\n").trim();
}

export type SellerPortalAnalyticsDownloadResult = {
  workbookBuffer: Buffer;
  downloadedFileName: string;
  downloadedFilePath: string;
  downloadedAt: string;
  warnings: string[];
};

@Injectable()
export class WbSellerPortalPlaywrightClient {
  private readonly logger = new Logger(WbSellerPortalPlaywrightClient.name);
  private readonly pageLoadTimeoutMs = appEnv.wbCabinetRequestTimeoutMs;
  private readonly downloadTimeoutMs = 180_000;
  private readonly reportPollIntervalMs = 2_000;
  private readonly reportPollMaxAttempts = 90;

  // Available whenever a storage state file path is configured; actual login
  // validity is verified at runtime. Works on both Linux and macOS.
  isAvailable(): boolean {
    return Boolean(appEnv.wbCabinetStorageStatePath);
  }

  async exportFreeSearchAnalyticsReport(input: {
    periodFrom: string;
    periodTo: string;
    reportName: string;
  }): Promise<SellerPortalAnalyticsDownloadResult> {
    const launchOptions: LaunchOptions = { headless: appEnv.wbCabinetHeadless };
    if (appEnv.wbCabinetExecutablePath) {
      launchOptions.executablePath = appEnv.wbCabinetExecutablePath;
    }

    const warnings: string[] = [];
    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
      storageState: appEnv.wbCabinetStorageStatePath,
    });

    try {
      const page = await context.newPage();

      await page.goto(SELLER_PORTAL_ANALYTICS_URL, {
        waitUntil: "domcontentloaded",
        timeout: this.pageLoadTimeoutMs,
      });
      // Wait for network to settle, then additionally wait for either the
      // analytics page heading or a login indicator to appear in the DOM.
      await page.waitForLoadState("networkidle", { timeout: this.pageLoadTimeoutMs }).catch(() => undefined);
      // Extra grace period for JS-heavy SPA rendering before running helpers.
      await page.waitForTimeout(3000);

      await page.evaluate(buildHelperScript());

      // Wait for the analytics content to be rendered (SPA may take several
      // seconds to mount). Retry the session check for up to 30 seconds.
      let session = { ok: false, error: "" as string | undefined };
      for (let attempt = 0; attempt < 15; attempt++) {
        const sessionPayload: string = await page.evaluate(
          () => (globalThis as any).__wbSellerPortalExport.ensureSession(),
        );
        const parsed = JSON.parse(sessionPayload) as { ok: boolean; error?: string; fatal?: boolean };
        if (parsed.ok) {
          session = { ok: true, error: undefined };
          break;
        }
        // If the error is from page-load (not yet rendered) retry after a delay.
        if (parsed.fatal && parsed.error && parsed.error.includes("поисковые")) {
          break;
        }
        this.logger.log(`Seller portal session check attempt ${attempt + 1}: ${parsed.error}`);
        await page.waitForTimeout(2000);
        // Re-inject helpers in case the SPA re-rendered and wiped the window object.
        await page.evaluate(buildHelperScript()).catch(() => undefined);
      }
      const sessionResult: string = await page.evaluate(
        () => (globalThis as any).__wbSellerPortalExport.ensureSession(),
      );
      const finalSession = JSON.parse(sessionResult) as { ok: boolean; error?: string };
      if (!finalSession.ok) {
        throw new Error(finalSession.error ?? "WB seller portal session check failed (Playwright).");
      }

      const startDateRu = formatIsoDateForRuInput(input.periodFrom);
      const endDateRu = formatIsoDateForRuInput(input.periodTo);
      const periodPayload: string = await page.evaluate(
        ([start, end]) => (globalThis as any).__wbSellerPortalExport.configurePeriod(start, end),
        [startDateRu, endDateRu] as [string, string],
      );
      const period = JSON.parse(periodPayload) as { ok: boolean; error?: string; warnings?: string[] };
      if (!period.ok) {
        throw new Error(period.error ?? "WB seller portal period configuration failed (Playwright).");
      }
      if (period.warnings?.length) warnings.push(...period.warnings);

      // Give the UI time to update after period selection before export
      await page.waitForTimeout(1000);

      // Set up download interception BEFORE the export button click so the
      // 'download' event is not missed when the browser immediately serves the file.
      const downloadPromise = page.waitForEvent("download", { timeout: this.downloadTimeoutMs });

      const exportPayload: string = await page.evaluate(
        (name) => (globalThis as any).__wbSellerPortalExport.prepareExport(name),
        input.reportName,
      );
      const exportResult = JSON.parse(exportPayload) as { ok: boolean; error?: string };
      if (!exportResult.ok) {
        throw new Error(exportResult.error ?? "WB seller portal export trigger failed (Playwright).");
      }

      await page.waitForTimeout(500);

      const downloadsPayload: string = await page.evaluate(
        () => (globalThis as any).__wbSellerPortalExport.openDownloads(),
      );
      const downloadsResult = JSON.parse(downloadsPayload) as { ok: boolean; error?: string };
      if (!downloadsResult.ok) {
        warnings.push(
          downloadsResult.error ??
            "Could not open seller portal downloads panel; will still wait for XLSX download event.",
        );
      }

      // Poll for the download link to become active; the helper script clicks
      // it which triggers the Playwright download event.
      let downloadStarted = false;
      for (let attempt = 0; attempt < this.reportPollMaxAttempts; attempt++) {
        await page.waitForTimeout(this.reportPollIntervalMs);
        const dlPayload: string = await page.evaluate(
          (name) => (globalThis as any).__wbSellerPortalExport.tryDownloadReport(name),
          input.reportName,
        );
        const dlResult = JSON.parse(dlPayload) as {
          ok?: boolean;
          downloadRequested?: boolean;
          fatal?: boolean;
          error?: string;
        };
        if (dlResult.downloadRequested) {
          downloadStarted = true;
          this.logger.log(
            `Seller portal XLSX download started for report "${input.reportName}" (attempt ${attempt + 1}).`,
          );
          break;
        }
        if (dlResult.fatal) {
          throw new Error(dlResult.error ?? "WB seller portal download failed (Playwright).");
        }
        if (attempt % 15 === 0) {
          this.logger.log(
            `Waiting for seller portal report "${input.reportName}" to become ready (attempt ${attempt + 1}).`,
          );
        }
      }

      if (!downloadStarted) {
        throw new Error(
          `WB seller portal XLSX download for "${input.reportName}" did not start within the timeout (Playwright).`,
        );
      }

      const download = await downloadPromise;
      const downloadedFilePath = (await download.path()) ?? "";
      const downloadedFileName = download.suggestedFilename();
      const downloadedAt = new Date().toISOString();

      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      const workbookBuffer = Buffer.concat(chunks);

      this.logger.log(
        `Seller portal analytics XLSX downloaded: "${downloadedFileName}" (${workbookBuffer.length} bytes).`,
      );

      return { workbookBuffer, downloadedFileName, downloadedFilePath, downloadedAt, warnings };
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  async updateSession(items: Array<{ name: string; value: string }>) {
    await mergeSellerPortalLocalStorage(items);
    this.logger.log(
      `WB seller portal session updated with ${items.length} localStorage item(s).`,
    );
  }
}
