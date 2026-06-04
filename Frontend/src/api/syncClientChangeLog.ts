import { apiClient } from "./syncClientHttp";

export type UnifiedChangeLogEntry = {
  id: string;
  source: "cluster" | "system";
  entityType: string;
  nmId: number | null;
  advertId: number | null;
  vendorCode: string | null;
  initiatedBy: "user" | "automation" | null;
  entityLabel: string | null;
  changeType: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

export async function fetchUnifiedChangeLog(limit = 500): Promise<UnifiedChangeLogEntry[]> {
  const response = await apiClient.get<{ entries: UnifiedChangeLogEntry[] }>(
    `/wb-clusters/change-log?limit=${String(limit)}`,
  );
  return response.data?.entries ?? [];
}
