import * as wb_clusters_command_flow from "./wb-clusters-command-flow";
import type { WbClustersWriteLanesContext } from "./wb-clusters.flow-context";
import { WbClustersServiceReadInternals } from "./wb-clusters.service.read-internals";

export abstract class WbClustersServiceCommandInternals extends WbClustersServiceReadInternals {
  protected scheduleClusterBidWritePass() {
    return wb_clusters_command_flow.scheduleClusterBidWritePass(
      this as unknown as WbClustersWriteLanesContext,
    );
  }

  protected scheduleClusterActionWritePass() {
    return wb_clusters_command_flow.scheduleClusterActionWritePass(
      this as unknown as WbClustersWriteLanesContext,
    );
  }

  protected isPromotionLowNoiseModeActive() {
    return wb_clusters_command_flow.isPromotionLowNoiseModeActive(
      this as unknown as WbClustersWriteLanesContext,
    );
  }

  protected getPromotionLowNoiseRemainingMs() {
    return wb_clusters_command_flow.getPromotionLowNoiseRemainingMs(
      this as unknown as WbClustersWriteLanesContext,
    );
  }

  protected async refreshProductAdvertisingInternal(
    nmId: number,
    syncRunId: string,
  ): Promise<void> {
    return wb_clusters_command_flow.refreshProductAdvertisingInternal(this, nmId, syncRunId);
  }

  protected async processClusterBidWritePass(reason: "apply-command" | "cron") {
    return wb_clusters_command_flow.processClusterBidWritePass(
      this as unknown as WbClustersWriteLanesContext,
      reason,
    );
  }

  protected async processClusterActionWritePass(reason: "apply-command" | "cron") {
    return wb_clusters_command_flow.processClusterActionWritePass(
      this as unknown as WbClustersWriteLanesContext,
      reason,
    );
  }

  protected async processClusterBidReconcilePass() {
    return wb_clusters_command_flow.processClusterBidReconcilePass(
      this as unknown as WbClustersWriteLanesContext,
    );
  }

  protected async resolveCampaignInventoryForProduct(input: {
    nmId: number;
    syncRunId: string;
    warningMessages: string[];
    preferStoredInventory?: boolean;
  }) {
    return wb_clusters_command_flow.resolveCampaignInventoryForProduct(this, input);
  }

  protected async refreshCampaignProductSlice(input: {
    syncRunId: string;
    nmId: number;
    statsPeriod: { from: string; to: string };
    cabinetSessionReady: boolean;
    cmpBridgeAvailable: boolean;
    advertId: number;
    paymentType: string | null;
    products: Array<{
      nmId: number;
      subjectId: number | null;
      subjectName: string | null;
    }>;
    warningMessages: string[];
  }) {
    return wb_clusters_command_flow.refreshCampaignProductSlice(this, input);
  }

  protected scheduleProductAdvertisingRefresh(nmId: number, reason: string) {
    return wb_clusters_command_flow.scheduleProductAdvertisingRefresh(
      this as unknown as WbClustersWriteLanesContext,
      nmId,
      reason,
    );
  }

  protected normalizeNormQueryBidsFromWb(
    bids: Array<{
      advert_id: number;
      nm_id: number;
      norm_query: string;
      bid?: number;
    }>,
  ) {
    return wb_clusters_command_flow.normalizeNormQueryBidsFromWb(
      this as unknown as WbClustersWriteLanesContext,
      bids,
    );
  }

  protected normalizeAdvertisingText(value: string) {
    return wb_clusters_command_flow.normalizeAdvertisingText(
      this as unknown as WbClustersWriteLanesContext,
      value,
    );
  }
}
