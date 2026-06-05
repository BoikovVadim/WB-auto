// Черновик несохранённых ролей кластеров для модалки «Настройка фильтров». Живёт в
// localStorage (через общий keyedDraftStorage), чтобы выбор НЕ сбрасывался при
// F5/переоткрытии: применяется на бэкенд только по «Сохранить», очищается после него.

import { createKeyedDraftStorage } from "./keyedDraftStorage";

export type ClusterFilterRole = "auto" | "protected" | "blacklisted";

/** Карта normalizedClusterName → роль. Хранятся только отличия от серверного состояния. */
export type ClusterFilterDraft = Record<string, ClusterFilterRole>;

const ROLES: ReadonlySet<string> = new Set<ClusterFilterRole>(["auto", "protected", "blacklisted"]);

function isClusterFilterRole(value: unknown): value is ClusterFilterRole {
  return typeof value === "string" && ROLES.has(value);
}

const storage = createKeyedDraftStorage<ClusterFilterRole>({
  namespace: "wb-cluster-filter-draft",
  isValue: isClusterFilterRole,
});

export const readClusterFilterDraft = storage.read;
export const writeClusterFilterDraft = storage.write;
export const clearClusterFilterDraft = storage.clear;
