import { useMemo, type ComponentProps } from "react";

import { ProductAdvertisingWorkspacePane } from "./advertising/ProductAdvertisingWorkspacePane";

type DetailWorkspacePaneProps = ComponentProps<typeof ProductAdvertisingWorkspacePane>;

/**
 * Мемоизированная панель рекламного воркспейса детали товара. Вынесена из WbDashboard
 * (оркестрация): сборка пропсов + useMemo — отдельная ответственность, а сам элемент
 * пробрасывается в shell как `detailWorkspace`. Стабильная ссылка сохраняется тем же
 * набором зависимостей, что и раньше.
 */
export function useDetailWorkspacePane(props: DetailWorkspacePaneProps) {
  const {
    nmId,
    vendorCode,
    detailRevisions,
    workspace,
    dateRange,
    onDateRangeChange,
    loadError,
    isWorkspaceLoading,
    isAdvertisingSyncStarting,
    onRunAdvertisingSync,
    onReloadSheet,
  } = props;

  return useMemo(
    () => (
      <ProductAdvertisingWorkspacePane
        nmId={nmId}
        vendorCode={vendorCode}
        detailRevisions={detailRevisions}
        workspace={workspace}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        loadError={loadError}
        isWorkspaceLoading={isWorkspaceLoading}
        isAdvertisingSyncStarting={isAdvertisingSyncStarting}
        onRunAdvertisingSync={onRunAdvertisingSync}
        onReloadSheet={onReloadSheet}
      />
    ),
    [
      nmId,
      vendorCode,
      detailRevisions,
      workspace,
      dateRange,
      onDateRangeChange,
      loadError,
      isWorkspaceLoading,
      isAdvertisingSyncStarting,
      onRunAdvertisingSync,
      onReloadSheet,
    ],
  );
}
