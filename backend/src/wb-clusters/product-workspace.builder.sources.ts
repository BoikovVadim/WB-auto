import type { ProductAdvertisingSheetResponse } from "./wb-clusters.types";

type WorkspaceClusterRow = ProductAdvertisingSheetResponse["clusters"][number];

export function normalizeWorkspaceText(value: string) {
  return value.trim().toLocaleLowerCase("ru");
}

export function isWorkspaceClusterActive(row: WorkspaceClusterRow) {
  return row.sourceKind === "active" && row.isActive !== false;
}

export function isWorkspaceClusterExcluded(row: WorkspaceClusterRow) {
  return row.sourceKind === "excluded" || row.isActive === false;
}

export function getWorkspaceSourcePriority(
  sourceKind: ProductAdvertisingSheetResponse["clusters"][number]["sourceKind"],
  isActive: boolean | null,
) {
  if (sourceKind === "excluded" || isActive === false) {
    return 0;
  }

  if (sourceKind === "active") {
    return 1;
  }

  if (sourceKind === "stats") {
    return 2;
  }

  return 3;
}
