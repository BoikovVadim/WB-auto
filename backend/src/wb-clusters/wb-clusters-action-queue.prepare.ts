import {
  buildMergedClusterActionList,
} from "./wb-clusters-queue.helpers";
import type {
  ActionQueueRuntime,
  ClusterActionWriteGroup,
  PreparedClusterActionWriteGroup,
} from "./wb-clusters-action-queue.types";
import { WbClustersActionQueueState } from "./wb-clusters-action-queue.state";

export abstract class WbClustersActionQueuePrepare extends WbClustersActionQueueState {
  protected abstract processWriteMultiGroupBatch(
    groups: PreparedClusterActionWriteGroup[],
    reason: "apply-command" | "cron",
    runtime: ActionQueueRuntime,
  ): Promise<void>;

  async processWritePass(
    reason: "apply-command" | "cron",
    runtime: ActionQueueRuntime,
  ) {
    while (true) {
      if (this.wbPromotionApiClient.hasActiveMinusWriteCooldown()) {
        return;
      }

      const claimedJobs = await this.wbClustersRepository.claimReadyClusterActionJobs(
        runtime.maxActionJobsPerPass,
      );
      if (claimedJobs.length === 0) {
        return;
      }

      const groupedJobs = new Map<string, ClusterActionWriteGroup>();

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
        .map((group) => this.prepareClusterActionWriteGroup(group))
        .filter((group): group is PreparedClusterActionWriteGroup => group !== null);

      const batchGroups: PreparedClusterActionWriteGroup[] = [];
      for (const group of preparedGroups) {
        if (batchGroups.length > 0 && batchGroups.length >= runtime.maxActionGroupsPerBatch) {
          await this.processWriteMultiGroupBatch(batchGroups, reason, runtime);
          batchGroups.length = 0;
        }

        batchGroups.push(group);
      }

      if (batchGroups.length > 0) {
        await this.processWriteMultiGroupBatch(batchGroups, reason, runtime);
      }
    }
  }

  protected prepareClusterActionWriteGroup(group: ClusterActionWriteGroup) {
    const sortedJobs = [...group.jobs].sort((left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt),
    );
    const mergedActionList = buildMergedClusterActionList(sortedJobs);
    if (mergedActionList.length === 0) {
      void this.wbClustersRepository.failClusterActionJobs(
        sortedJobs.map((job) => job.jobId),
        "No active cluster action items remained for processing.",
      );
      return null;
    }

    return {
      advertId: group.advertId,
      nmId: group.nmId,
      sortedJobs,
      mergedActionList,
      jobIds: sortedJobs.map((job) => job.jobId),
    };
  }

}
