import type {
  AutomationMode,
  ClusterAutomationStateValue,
  ClusterReviewStatus,
} from "./wb-clusters.repository.automation";

/** Статус автоматизации кампании для UI (режим + порог + счётчик ревью + per-cluster решения). */
export interface ClusterAutomationStatusResult {
  mode: AutomationMode;
  maxCpo: number | null;
  /** Сколько новых кластеров ждёт ручной модерации (review_status=pending). */
  pendingCount: number;
  clusters: {
    normalizedClusterName: string;
    state: ClusterAutomationStateValue;
    manualProtected: boolean;
    lastCpo: number | null;
    lastDecision: string | null;
    reviewStatus: ClusterReviewStatus;
  }[];
}
