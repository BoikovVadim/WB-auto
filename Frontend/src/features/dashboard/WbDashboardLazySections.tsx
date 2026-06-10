import { lazy } from "react";

/**
 * Реестр ЛЕНИВЫХ секций дашборда (code-splitting). Каждая тяжёлая/редкая секция грузится
 * отдельным чанком при первом открытии (через Suspense в WbDashboardShell), дальше — из кэша
 * браузера мгновенно. Главный выигрыш — рекламная подсистема (DashboardProductsSection, ~12k
 * строк) и матричные detail-листы уезжают из initial-бандла, ускоряя первую загрузку всех экранов.
 *
 * Eager (в основном бандле, НЕ здесь): главная таблица товаров/юнит-экономики + лёгкие Hub/Tech —
 * они на самом частом дефолтном пути, отдельный чанк под них только замедлил бы первый экран.
 *
 * Прямые lazy()-вызовы (а не generic-обёртка): так TS сохраняет типы пропсов каждого компонента
 * из named-export — обёртка с ComponentType свела бы пропсы к never.
 */
export const DashboardProductsSection = lazy(() =>
  import("./DashboardProductsSection").then((m) => ({ default: m.DashboardProductsSection })),
);
export const DashboardCampaignsSection = lazy(() =>
  import("./DashboardCampaignsSection").then((m) => ({ default: m.DashboardCampaignsSection })),
);
export const DashboardCatalogSection = lazy(() =>
  import("./DashboardCatalogSection").then((m) => ({ default: m.DashboardCatalogSection })),
);
export const DashboardClusterStatsSection = lazy(() =>
  import("./DashboardClusterStatsSection").then((m) => ({ default: m.DashboardClusterStatsSection })),
);
export const DashboardDailyStatsSection = lazy(() =>
  import("./DashboardDailyStatsSection").then((m) => ({ default: m.DashboardDailyStatsSection })),
);
export const DashboardExportsOverviewSection = lazy(() =>
  import("./DashboardExportsOverviewSection").then((m) => ({ default: m.DashboardExportsOverviewSection })),
);
export const DashboardJamStatusSection = lazy(() =>
  import("./DashboardJamStatusSection").then((m) => ({ default: m.DashboardJamStatusSection })),
);
export const DashboardMethodWorkspaceSection = lazy(() =>
  import("./DashboardMethodWorkspaceSection").then((m) => ({ default: m.DashboardMethodWorkspaceSection })),
);
export const DashboardMinusPhrasesSection = lazy(() =>
  import("./DashboardMinusPhrasesSection").then((m) => ({ default: m.DashboardMinusPhrasesSection })),
);
export const DashboardCatalogProductDetailSection = lazy(() =>
  import("./DashboardCatalogProductDetailSection").then((m) => ({ default: m.DashboardCatalogProductDetailSection })),
);
export const DashboardOrdersDetailSection = lazy(() =>
  import("./DashboardOrdersDetailSection").then((m) => ({ default: m.DashboardOrdersDetailSection })),
);
export const DashboardOrdersSumDetailSection = lazy(() =>
  import("./DashboardOrdersSumDetailSection").then((m) => ({ default: m.DashboardOrdersSumDetailSection })),
);
export const DashboardRevenueDetailSection = lazy(() =>
  import("./DashboardRevenueDetailSection").then((m) => ({ default: m.DashboardRevenueDetailSection })),
);
export const DashboardCostSumDetailSection = lazy(() =>
  import("./DashboardCostSumDetailSection").then((m) => ({ default: m.DashboardCostSumDetailSection })),
);
export const DashboardAdSpendDetailSection = lazy(() =>
  import("./DashboardAdSpendDetailSection").then((m) => ({ default: m.DashboardAdSpendDetailSection })),
);
export const DashboardDrrPercentDetailSection = lazy(() =>
  import("./DashboardDrrPercentDetailSection").then((m) => ({ default: m.DashboardDrrPercentDetailSection })),
);
export const DashboardCpoDetailSection = lazy(() =>
  import("./DashboardCpoDetailSection").then((m) => ({ default: m.DashboardCpoDetailSection })),
);
export const DashboardSppDetailSection = lazy(() =>
  import("./DashboardSppDetailSection").then((m) => ({ default: m.DashboardSppDetailSection })),
);
export const DashboardAcquiringDetailSection = lazy(() =>
  import("./DashboardAcquiringDetailSection").then((m) => ({ default: m.DashboardAcquiringDetailSection })),
);
export const DashboardMarginDetailSection = lazy(() =>
  import("./DashboardMarginDetailSection").then((m) => ({ default: m.DashboardMarginDetailSection })),
);
export const DashboardPricesDetailSection = lazy(() =>
  import("./DashboardPricesDetailSection").then((m) => ({ default: m.DashboardPricesDetailSection })),
);
export const DashboardStocksDetailSection = lazy(() =>
  import("./DashboardStocksDetailSection").then((m) => ({ default: m.DashboardStocksDetailSection })),
);
export const DashboardBuyoutDetailSection = lazy(() =>
  import("./DashboardBuyoutDetailSection").then((m) => ({ default: m.DashboardBuyoutDetailSection })),
);
export const DashboardChangeHistorySection = lazy(() =>
  import("./DashboardChangeHistorySection").then((m) => ({ default: m.DashboardChangeHistorySection })),
);
export const DashboardUnitEconomicsSettingsSection = lazy(() =>
  import("./DashboardUnitEconomicsSettingsSection").then((m) => ({ default: m.DashboardUnitEconomicsSettingsSection })),
);
export const DashboardQueryFrequenciesSection = lazy(() =>
  import("./DashboardQueryFrequenciesSection").then((m) => ({ default: m.DashboardQueryFrequenciesSection })),
);
export const DashboardSyncRunsSection = lazy(() =>
  import("./DashboardSyncRunsSection").then((m) => ({ default: m.DashboardSyncRunsSection })),
);

/**
 * Прогрев ВСЕХ чанков секций (вызывается в idle после первого кадра — см. useIdleSectionChunkWarmup).
 * Initial paint не блокируется (секции ленивые), но к моменту клика пользователя чанки уже в кэше
 * браузера → открытие без Suspense-fallback. import() дедуплицируется (повторный вызов — no-op).
 */
export function warmAllSectionChunks(): void {
  const loaders = [
    () => import("./DashboardProductsSection"),
    () => import("./DashboardCampaignsSection"),
    () => import("./DashboardCatalogSection"),
    () => import("./DashboardClusterStatsSection"),
    () => import("./DashboardDailyStatsSection"),
    () => import("./DashboardExportsOverviewSection"),
    () => import("./DashboardJamStatusSection"),
    () => import("./DashboardMethodWorkspaceSection"),
    () => import("./DashboardMinusPhrasesSection"),
    () => import("./DashboardCatalogProductDetailSection"),
    () => import("./DashboardOrdersDetailSection"),
    () => import("./DashboardOrdersSumDetailSection"),
    () => import("./DashboardRevenueDetailSection"),
    () => import("./DashboardCostSumDetailSection"),
    () => import("./DashboardAdSpendDetailSection"),
    () => import("./DashboardDrrPercentDetailSection"),
    () => import("./DashboardCpoDetailSection"),
    () => import("./DashboardSppDetailSection"),
    () => import("./DashboardAcquiringDetailSection"),
    () => import("./DashboardMarginDetailSection"),
    () => import("./DashboardPricesDetailSection"),
    () => import("./DashboardStocksDetailSection"),
    () => import("./DashboardBuyoutDetailSection"),
    () => import("./DashboardChangeHistorySection"),
    () => import("./DashboardUnitEconomicsSettingsSection"),
    () => import("./DashboardQueryFrequenciesSection"),
    () => import("./DashboardSyncRunsSection"),
  ];
  for (const load of loaders) void load().catch(() => undefined);
}

/** Заглушка на время загрузки чанка секции (мелькает только при ПЕРВОМ открытии раздела). */
export function SectionFallback() {
  return (
    <div
      className="wb-card"
      style={{
        padding: 32,
        color: "var(--wb-text-muted)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span className="app-shell__spinner" aria-hidden />
      Загрузка раздела…
    </div>
  );
}
