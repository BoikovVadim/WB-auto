import { Injectable, Logger } from "@nestjs/common";

import { executeAppleScript } from "./wb-cmp-safari.client.apple-script";
import { SerialTaskQueue, sleep } from "./wb-cmp-safari.client.queue";
import {
  parseWordsClustersWorkbookBuffer,
} from "./wb-cmp-safari.client.response";
import { ReusableSafariWindowRunner } from "./wb-cmp-safari.client.reusable-window";
import { exportSellerPortalSearchAnalyticsReport } from "./wb-cmp-safari.client.seller-portal";
import { buildWordsClustersBrowserScript } from "./wb-cmp-safari.client.words-clusters-script";

@Injectable()
export class WbCmpSafariClient {
  private readonly logger = new Logger(WbCmpSafariClient.name);
  private readonly safariScriptTimeoutMs = 120_000;
  private readonly sellerPortalDownloadWaitMs = 120_000;
  private readonly sellerPortalDownloadPollMs = 1_000;
  private readonly safariQueue = new SerialTaskQueue();
  private readonly reusableWindowRunner: ReusableSafariWindowRunner;

  constructor() {
    this.reusableWindowRunner = new ReusableSafariWindowRunner({
      defaultTimeoutMs: this.safariScriptTimeoutMs,
      runAppleScript: (appleScript, options) =>
        this.runAppleScript(appleScript, options.timeoutMs),
    });
  }

  isAvailable() {
    return process.platform === "darwin";
  }

  async exportWordsClusters(advertId: number, nmId: number) {
    if (!this.isAvailable()) {
      throw new Error("WB cmp Safari bridge is only available on macOS.");
    }

    return this.safariQueue.enqueue(async () => {
      const targetUrl = `https://cmp.wildberries.ru/campaigns/edit/${advertId}?advertID=${advertId}&nmId=${nmId}`;
      const rawResponse = await this.reusableWindowRunner.run(
        targetUrl,
        buildWordsClustersBrowserScript(advertId),
        {
        readyUrlSubstring: "cmp.wildberries.ru/campaigns/edit/",
        },
      );
      return parseWordsClustersWorkbookBuffer(rawResponse, advertId, nmId);
    });
  }

  async exportFreeSearchAnalyticsReport(input: {
    periodFrom: string;
    periodTo: string;
    reportName: string;
  }) {
    if (!this.isAvailable()) {
      throw new Error("WB seller-portal Safari bridge is only available on macOS.");
    }

    return exportSellerPortalSearchAnalyticsReport(input, {
      downloadWaitMs: this.sellerPortalDownloadWaitMs,
      downloadPollMs: this.sellerPortalDownloadPollMs,
      runAppleScript: (appleScript, options) =>
        this.runAppleScript(appleScript, options.timeoutMs, options.errorContext),
      sleep,
    });
  }

  private async runAppleScript(
    appleScript: string,
    timeoutMs = this.safariScriptTimeoutMs,
    errorContext = "Failed to execute WB Safari bridge",
  ) {
    return executeAppleScript(appleScript, {
      timeoutMs,
      errorContext,
      onStderr: (message) => {
        this.logger.warn(message);
      },
    });
  }
}
