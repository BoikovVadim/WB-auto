import type { Dispatch, SetStateAction } from "react";

import type {
  ExportMethodStatus,
  IntegrationStatusResponse,
  SyncEntity,
  TokenSessionResponse,
  WbExportJobResponse,
  WbExportListItem,
  WbExportResponse,
} from "../../api/syncClient";
import type { ProductAdvertisingSheetRequestInput } from "../../api/productAdvertisingSheetIdentity";
import type { AdvertisingDateRange } from "./advertising/date";
import type {
  ProductAdvertisingDetailInvalidationTarget,
  ProductAdvertisingDetailRevisions,
} from "./advertising/productAdvertisingDetailInvalidation";
import type { DashboardSection, ProductsMode } from "./persistence/dashboardViewState";

export type DashboardProductCampaignCounts = {
  total: number;
  active: number;
  paused: number;
  disabled: number;
};

export type DashboardProductOption = {
  vendorCode: string;
  nmId: number | null;
  campaignCounts?: DashboardProductCampaignCounts;
};

export type DashboardOpenExportOptions = {
  preserveProductSelection?: boolean;
  preferredProductSelection?: DashboardProductOption | null;
};

export type DashboardStatusNotice = {
  tone: "info" | "success";
  message: string;
} | null;

export type DashboardWorkspaceActionsInput = {
  primaryEntityType: SyncEntity;
  tokenInput: string;
  currentExport: WbExportResponse | null;
  activeExportJob: WbExportJobResponse | null;
  exportHistory: WbExportListItem[];
  methodArchive: WbExportListItem[];
  resolvedCatalogProduct: DashboardProductOption | null;
  productAdvertisingSheetRequestInput: ProductAdvertisingSheetRequestInput | null;
  productAdvertisingDateRange: AdvertisingDateRange;
  openProductsList: () => void;
  openProductDetail: (product: DashboardProductOption) => void;
  registerCandidateProductSnapshotNmId: (nmId: number | null) => void;
  queueCandidateWarmup: (nmId: number | null) => void;
  prefetchCandidateSnapshot: (nmId: number | null) => void;
  productAdvertisingDetailRevisions: ProductAdvertisingDetailRevisions;
  invalidateProductAdvertisingDetail: (
    target?: ProductAdvertisingDetailInvalidationTarget,
  ) => void;
  setActiveSection: Dispatch<SetStateAction<DashboardSection>>;
  setProductsMode: Dispatch<SetStateAction<ProductsMode>>;
  setSelectedMethodEntity: Dispatch<SetStateAction<SyncEntity | null>>;
  setSelectedExportId: Dispatch<SetStateAction<string | null>>;
  setCurrentExport: Dispatch<SetStateAction<WbExportResponse | null>>;
  setActiveExportJob: Dispatch<SetStateAction<WbExportJobResponse | null>>;
  setSelectedProductNmId: Dispatch<SetStateAction<number | null>>;
  setSelectedCatalogVendorCode: Dispatch<SetStateAction<string | null>>;
  setIsArchiveLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setStatusNotice: Dispatch<SetStateAction<DashboardStatusNotice>>;
  setTokenSession: Dispatch<SetStateAction<TokenSessionResponse | null>>;
  setTokenInput: Dispatch<SetStateAction<string>>;
  setIsTokenSaving: Dispatch<SetStateAction<boolean>>;
  setIsExportLoading: Dispatch<SetStateAction<boolean>>;
  setIsAdvertisingSyncStarting: Dispatch<SetStateAction<boolean>>;
  setProductAdvertisingDateRange: Dispatch<SetStateAction<AdvertisingDateRange>>;
  setProductsSortKey: Dispatch<SetStateAction<import("./useDashboardProductsWorkspace").ProductListSortKey>>;
  setProductsSortDirection: Dispatch<SetStateAction<"asc" | "desc">>;
  setExportHistory: Dispatch<SetStateAction<WbExportListItem[]>>;
  setExportMethods: Dispatch<SetStateAction<ExportMethodStatus[]>>;
  setIntegrationStatus: Dispatch<SetStateAction<IntegrationStatusResponse | null>>;
};
