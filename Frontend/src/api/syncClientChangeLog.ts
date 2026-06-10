import { apiClient } from "./syncClientHttp";

export type UnifiedChangeLogEntry = {
  id: string;
  source: "cluster" | "system";
  entityType: string;
  nmId: number | null;
  advertId: number | null;
  vendorCode: string | null;
  initiatedBy: "user" | "automation" | null;
  /** Причина авто-смены ставки (up/down/at_cap/...); null у ручных/системных. */
  reason: string | null;
  /** Замеренная позиция в выдаче на момент авто-смены ставки; null у ручных/системных. */
  position: number | null;
  entityLabel: string | null;
  changeType: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  /** Курсор для подгрузки «показать ещё»: передать как cursor для следующей порции. */
  cursor: string;
};

export async function fetchUnifiedChangeLog(
  limit = 500,
  cursor?: string | null,
): Promise<UnifiedChangeLogEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const response = await apiClient.get<{ entries: UnifiedChangeLogEntry[] }>(
    `/wb-clusters/change-log?${params.toString()}`,
  );
  return response.data?.entries ?? [];
}
