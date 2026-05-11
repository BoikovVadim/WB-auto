import { buildMergedClusterBidList } from "./wb-clusters-queue.helpers";
import { WbClustersBidQueueWriteBatch } from "./wb-clusters-bid-queue.write-batch";
import type {
  BidQueueRuntime,
  ClusterBidWriteGroup,
  PreparedClusterBidWriteGroup,
} from "./wb-clusters-bid-queue.types";

export abstract class WbClustersBidQueueWritePass extends WbClustersBidQueueWriteBatch {
  async processWritePass(
    reason: "apply-command" | "cron",
    runtime: BidQueueRuntime,
  ) {
    while (true) {
      if (this.wbPromotionApiClient.hasActiveBidWriteCooldown()) {
        return;
      }

      const claimedJobs = await this.wbClustersRepository.claimReadyClusterBidJobs(
        runtime.maxBidJobsPerPass,
      );
      if (claimedJobs.length === 0) {
        return;
      }

      const groupedJobs = new Map<string, ClusterBidWriteGroup>();

      for (const claimedJob of claimedJobs) {
        const groupKey = `batched:${claimedJob.advertId}:${claimedJob.nmId}`;
        const existingGroup = groupedJobs.get(groupKey);
        if (existingGroup) {
          existingGroup.jobs.push(claimedJob);
          continue;
        }

        groupedJobs.set(groupKey, {
          advertId: claimedJob.advertId,
          nmId: claimedJob.nmId,
          jobs: [claimedJob],
        });
      }

      const preparedGroups = Array.from(groupedJobs.values())
        .map((group) => this.prepareClusterBidWriteGroup(group))
        .filter((group): group is PreparedClusterBidWriteGroup => group !== null);

      const regularGroups: PreparedClusterBidWriteGroup[] = [];
      for (const group of preparedGroups) {
        if (group.mergedBidList.length > 100) {
          await this.processWriteJobGroup(
            {
              advertId: group.advertId,
              nmId: group.nmId,
              jobs: group.sortedJobs,
            },
            reason,
            runtime,
          );
          continue;
        }

        regularGroups.push(group);
      }

      const batchGroups: PreparedClusterBidWriteGroup[] = [];
      let batchSize = 0;
      for (const group of regularGroups) {
        const nextSize = batchSize + group.mergedBidList.length;
        if (batchGroups.length > 0 && nextSize > 100) {
          await this.processWriteMultiGroupBatch(batchGroups, reason, runtime);
          batchGroups.length = 0;
          batchSize = 0;
        }

        batchGroups.push(group);
        batchSize += group.mergedBidList.length;
      }

      if (batchGroups.length > 0) {
        await this.processWriteMultiGroupBatch(batchGroups, reason, runtime);
      }
    }
  }

  private prepareClusterBidWriteGroup(group: ClusterBidWriteGroup) {
    const sortedJobs = [...group.jobs].sort((left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt),
    );
    const mergedBidList = buildMergedClusterBidList(sortedJobs);
    if (mergedBidList.length === 0) {
      void this.wbClustersRepository.failClusterBidJobs(
        sortedJobs.map((job) => job.jobId),
        "No active cluster bid items remained for processing.",
      );
      return null;
    }

    return {
      advertId: group.advertId,
      nmId: group.nmId,
      sortedJobs,
      mergedBidList,
      jobIds: sortedJobs.map((job) => job.jobId),
    };
  }

}
