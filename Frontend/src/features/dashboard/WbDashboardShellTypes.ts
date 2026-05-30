import type { ReactNode } from "react";

import type {
  ExportMethodStatus,
  HealthResponse,
  IntegrationStatusResponse,
  SearchQueriesExportPayload,
  SearchQueryProduct,
  SyncEntity,
  TokenSessionResponse,
  WbExportJobResponse,
  WbExportListItem,
  WbExportResponse,
} from "../../api/syncClient";
import type {
  DashboardProductOption,
  DashboardStatusNotice,
} from "./useDashboardWorkspaceActionTypes";
import type { DashboardSection, ProductsMode } from "./persistence/dashboardViewState";

export type WbDashboardShellProps = {
  activeSection: DashboardSection;
  health: HealthResponse | null;
  integrationStatus: IntegrationStatusResponse | null;
  tokenSession: TokenSessionResponse | null;
  methodCards: ExportMethodStatus[];
  productsMode: ProductsMode;
  resolvedCatalogProduct: DashboardProductOption | null;
  productCatalogCount: number;
  productsSearch: string;
  hasCatalogItems: boolean;
  isCatalogLoading: boolean;
  filteredProducts: DashboardProductOption[];
  productsSortKey: import("./useDashboardProductsWorkspace").ProductListSortKey;
  productsSortDirection: "asc" | "desc";
  detailWorkspace: ReactNode;
  currentMethod: ExportMethodStatus | null;
  methodArchive: WbExportListItem[];
  selectedExportId: string | null;
  selectedMethodEntity: SyncEntity | null;
  isExportLoading: boolean;
  currentExport: WbExportResponse | null;
  activeExportJob: WbExportJobResponse | null;
  displayPayload: SearchQueriesExportPayload | null;
  isMethodTablesReady: boolean;
  selectedProductNmId: number | null;
  selectedProduct: SearchQueryProduct | null;
  isArchiveLoading: boolean;
  tokenInput: string;
  isTokenSaving: boolean;
  error?: string | null;
  statusNotice: DashboardStatusNotice;
  onSetExportsSection: () => void;
  onOpenJamSection: () => void;
  onOpenCatalogSection: () => void;
  onOpenCampaignsSection: () => void;
  onOpenSyncRunsSection: () => void;
  onOpenClusterStatsSection: () => void;
  onOpenDailyStatsSection: () => void;
  onOpenMinusPhrasesSection: () => void;
  onOpenQueryFrequenciesSection: () => void;
  onOpenProductsSection: () => void;
  onPrefetchProductsSection: () => void;
  onOpenCatalogProductsSection: () => void;
  onPrefetchCatalogProductsSection: () => void;
  onOpenUnitEconomicsSection: () => void;
  onOpenUnitEconomicsSettingsSection: () => void;
  onUnitEconomicsChargesInvalidate: () => void;
  onOpenDashboardSection: () => void;
  onOpenDashboardTechSection: () => void;
  onOpenDashboardCabinetSection: () => void;
  onOpenChangeHistorySection: () => void;
  isCostPriceSheetOpen: boolean;
  isCostPricesLoading: boolean;
  costPrices: Map<number, import("./DashboardCatalogProductsSection").CostPriceCurrent>;
  orderCounts: Map<number, import("../../api/syncClientOrders").TodayOrderCount>;
  ordersMatrix: import("./useOrdersMatrix").OrdersMatrix;
  buyoutCounts: Map<number, import("../../api/syncClientBuyouts").TodayBuyoutCount>;
  rollingBuyoutCounts: Map<number, import("../../api/syncClientBuyouts").TodayBuyoutCount>;
  stockCounts: Map<number, number>;
  priceCounts: Map<number, import("./useCurrentPrices").CurrentPriceEntry>;
  ordersSumValues: Map<number, number>;
  ordersSumMatrix: import("./useOrdersSumMatrix").OrdersSumMatrix;
  revenueValues: Map<number, number>;
  revenueMatrix: import("./useRevenueMatrix").RevenueMatrix;
  costSumValues: Map<number, number>;
  costSumMatrix: import("./useCostSumMatrix").CostSumMatrix;
  adSpendValues: Map<number, number>;
  adSpendMatrix: import("./useAdSpendMatrix").AdSpendMatrix;
  sppValues: Map<number, number>;
  sppMatrix: import("./useSppMatrix").SppMatrix;
  commissionValues: Map<number, number>;
  acquiringValues: Map<number, number>;
  drrValues: Map<number, number>;
  priceChangeStatuses: Map<number, import("../../api/syncClientPrices").PriceChangeStatus>;
  isOrdersSheetOpen: boolean;
  isBuyoutSheetOpen: boolean;
  isStocksSheetOpen: boolean;
  isPricesSheetOpen: boolean;
  isOrdersSumSheetOpen: boolean;
  isRevenueSheetOpen: boolean;
  isCostSumSheetOpen: boolean;
  isAdSpendSheetOpen: boolean;
  isSppSheetOpen: boolean;
  onOpenCostPriceSheet: () => void;
  onCloseCostPriceSheet: () => void;
  onOpenOrdersSheet: () => void;
  onCloseOrdersSheet: () => void;
  onOpenBuyoutSheet: () => void;
  onCloseBuyoutSheet: () => void;
  onOpenStocksSheet: () => void;
  onCloseStocksSheet: () => void;
  onOpenPricesSheet: () => void;
  onClosePricesSheet: () => void;
  onOpenOrdersSumSheet: () => void;
  onCloseOrdersSumSheet: () => void;
  onOpenRevenueSheet: () => void;
  onCloseRevenueSheet: () => void;
  onOpenCostSumSheet: () => void;
  onCloseCostSumSheet: () => void;
  onOpenAdSpendSheet: () => void;
  onCloseAdSpendSheet: () => void;
  onOpenSppSheet: () => void;
  onCloseSppSheet: () => void;
  onCostSaved: (nmId: number, value: number) => Promise<void>;
  onCostCleared: (nmIds: number[]) => Promise<void>;
  onPriceSaved: (nmId: number, targetFinal: number) => Promise<void>;
  onRefresh: () => void;
  onTokenInputChange: (value: string) => void;
  onSaveToken: () => void;
  onClearToken: () => void;
  onOpenMethod: (entityType: SyncEntity) => void;
  onPrefetchMethod: (entityType: SyncEntity) => void;
  onProductsSearchChange: (value: string) => void;
  onProductsSortToggle: (key: import("./useDashboardProductsWorkspace").ProductListSortKey) => void;
  onProductOpen: (product: DashboardProductOption) => void;
  onProductHover: (nmId: number | null) => void;
  onProductFocus: (nmId: number | null) => void;
  onBackToProducts: () => void;
  onBackToMethods: () => void;
  onRunExport: (entityType: SyncEntity) => void;
  onPrefetchSavedExport: (entityType: SyncEntity, exportId: string) => void;
  onOpenExport: (entityType: SyncEntity, exportId: string) => void;
  onSelectProduct: (nmId: number) => void;
};
