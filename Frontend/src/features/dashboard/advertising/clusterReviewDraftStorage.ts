// Черновик решений по новым кластерам («Новые кластеры на проверке»). Живёт в
// localStorage (через общий keyedDraftStorage), чтобы выбор (Авто/Белый/Чёрный) НЕ
// сбрасывался при F5/переоткрытии: кластеры применяются на бэкенд только по «Сохранить».

import type { ClusterReviewAction } from "../../../api/syncClientClusterAutomation";
import { createKeyedDraftStorage } from "./keyedDraftStorage";

/** Карта normalizedClusterName → выбранное решение (approve/protect/reject). */
export type ClusterReviewDraft = Record<string, ClusterReviewAction>;

const ACTIONS: ReadonlySet<string> = new Set<ClusterReviewAction>(["approve", "reject", "protect"]);

function isClusterReviewAction(value: unknown): value is ClusterReviewAction {
  return typeof value === "string" && ACTIONS.has(value);
}

const storage = createKeyedDraftStorage<ClusterReviewAction>({
  namespace: "wb-cluster-review-draft",
  isValue: isClusterReviewAction,
});

export const readClusterReviewDraft = storage.read;
export const writeClusterReviewDraft = storage.write;
export const clearClusterReviewDraft = storage.clear;
