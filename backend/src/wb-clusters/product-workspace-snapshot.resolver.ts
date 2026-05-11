import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";

import { ProductAdvertisingSnapshotRepository } from "./product-advertising-snapshot.repository";
import { ProductAdvertisingSnapshotResolver } from "./product-advertising-snapshot.resolver";
import { ProductWorkspaceRepository } from "./product-workspace.repository";
import { normalizeStoredWorkspacePayload } from "./product-workspace-snapshot.compat";
import { WbClustersRepository } from "./wb-clusters.repository";
import type {
  PreferredProductAdvertisingSnapshotSummaryRecord,
} from "./wb-clusters.repository";
import type {
  ProductAdvertisingWorkspaceCampaignTab,
  ProductAdvertisingWorkspaceResponse,
} from "./wb-clusters.types";

@Injectable()
export class ProductWorkspaceSnapshotResolver {
  constructor(
    @Inject(ProductAdvertisingSnapshotRepository)
    private readonly productAdvertisingSnapshotRepository: ProductAdvertisingSnapshotRepository,
    @Inject(ProductAdvertisingSnapshotResolver)
    private readonly productAdvertisingSnapshotResolver: ProductAdvertisingSnapshotResolver,
    @Inject(ProductWorkspaceRepository)
    private readonly productWorkspaceRepository: ProductWorkspaceRepository,
    @Inject(WbClustersRepository)
    private readonly wbClustersRepository: WbClustersRepository,
  ) {}

  async resolveWorkspaceShell(input: {
    nmId: number;
    currentPeriod?: { start: string; end: string } | null;
    schemaVersion: number;
    currentRefresh: {
      syncRunId: string;
      startedAt: string;
    } | null;
  }): Promise<ProductAdvertisingWorkspaceResponse> {
    // Fast path: when exact dates are known, try exact DB lookup first (no CTE overhead).
    // If the exact snapshot exists → return immediately.
    // If NOT found → fall through to CTE to find the closest available snapshot
    // (stale-while-revalidate: show yesterday's data rather than a blank screen).
    if (input.currentPeriod) {
      const storedWorkspace = await this.productWorkspaceRepository.getWorkspaceSnapshot({
        nmId: input.nmId,
        startDate: input.currentPeriod.start,
        endDate: input.currentPeriod.end,
        schemaVersion: input.schemaVersion,
      });
      if (storedWorkspace) {
        const normalizedWorkspace = normalizeStoredWorkspacePayload({
          payload: storedWorkspace.payload,
          currentRefresh: input.currentRefresh,
        });
        if (normalizedWorkspace) {
          return normalizedWorkspace;
        }
      }
      // Exact period not materialized yet — fall through to CTE below.
    }

    // SQL-direct fast path: строим workspace shell прямо из PostgreSQL для
    // запрошенного диапазона — без CTE и без устаревших данных.
    // Работает для ЛЮБОГО диапазона дат < 150 мс.
    if (input.currentPeriod) {
      const sqlShell = await this.wbClustersRepository.getWorkspaceShellDirectSQL(
        input.nmId,
        input.currentPeriod,
      );
      if (sqlShell) {
        return sqlShell;
      }
    }

    // CTE path: find the closest ready snapshot for the requested range.
    // Used when (a) no exact dates given, or (b) SQL-direct returned null (no campaigns).
    const preferredSummary = await this.resolvePreferredSnapshotSummary(input);
    if (!preferredSummary) {
      return this.buildFallbackWorkspaceResponse(input);
    }

    const storedWorkspace = await this.productWorkspaceRepository.getWorkspaceSnapshot({
      nmId: input.nmId,
      startDate: preferredSummary.startDate,
      endDate: preferredSummary.endDate,
      schemaVersion: preferredSummary.schemaVersion,
    });
    if (!storedWorkspace) {
      return this.buildFallbackWorkspaceResponse(input);
    }

    const normalizedWorkspace = normalizeStoredWorkspacePayload({
      payload: storedWorkspace.payload,
      currentRefresh: input.currentRefresh,
    });
    if (normalizedWorkspace) {
      return normalizedWorkspace;
    }

    return this.buildFallbackWorkspaceResponse(input);
  }

  async resolveWorkspaceCampaignRows(input: {
    nmId: number;
    advertId: number;
    currentPeriod?: { start: string; end: string } | null;
    schemaVersion: number;
  }) {
    // Always use SQL fast path when a date range is provided.
    // After the structure sync runs deactivateStaleActiveClusters, wb_clusters
    // reflects the correct active set and the SQL query is always fresh:
    // - source_kind / is_active via wb_clusters + wb_cluster_actions override
    // - bids via wb_cluster_bids JOIN (COALESCE with catalog prices)
    // Stored snapshots (wb_product_workspace_campaign_rows) are no longer read
    // because they can carry stale sourceKind/isActive values from before a
    // cluster was excluded, causing excluded rows to appear in the active filter.
    if (input.currentPeriod) {
      const sqlRows = await this.wbClustersRepository.getProductWorkspaceCampaignRowsSQL(
        input.nmId,
        input.advertId,
        input.currentPeriod,
      );
      return {
        nmId: input.nmId,
        startDate: input.currentPeriod.start,
        endDate: input.currentPeriod.end,
        schemaVersion: input.schemaVersion,
        advertId: input.advertId,
        payload: sqlRows,
        syncedAt: new Date().toISOString(),
      };
    }

    // Нет дат — CTE-путь: ближайший готовый снапшот.
    const preferredSummary = await this.resolvePreferredSnapshotSummary(input);
    if (!preferredSummary) {
      throw new ServiceUnavailableException({
        code: "workspace_campaign_rows_not_materialized",
        message: `Workspace campaign rows are not materialized yet for advert ${input.advertId}.`,
        readiness: {
          scope: "cluster_table",
          status: "materialization_pending",
          source: "workspace_snapshot",
          materializationStatus: "pending",
        },
        nmId: input.nmId,
        advertId: input.advertId,
      });
    }

    const storedRows = await this.productWorkspaceRepository.getWorkspaceCampaignRows({
      nmId: input.nmId,
      startDate: preferredSummary.startDate,
      endDate: preferredSummary.endDate,
      schemaVersion: preferredSummary.schemaVersion,
      advertId: input.advertId,
    });
    if (!storedRows) {
      throw new ServiceUnavailableException({
        code: "workspace_campaign_rows_not_materialized",
        message: `Workspace campaign rows are not materialized yet for advert ${input.advertId}.`,
        readiness: {
          scope: "cluster_table",
          status: "materialization_pending",
          source: "workspace_snapshot",
          materializationStatus: "pending",
        },
        nmId: input.nmId,
        advertId: input.advertId,
      });
    }

    return storedRows;
  }

  async resolveWorkspaceClusterQueries(input: {
    nmId: number;
    advertId: number;
    clusterKey: string;
    currentPeriod?: { start: string; end: string } | null;
    schemaVersion: number;
  }) {
    // Сначала пробуем готовый снапшот (мгновенно).
    if (input.currentPeriod) {
      const exactResult = await this.productWorkspaceRepository.getWorkspaceClusterQueries({
        nmId: input.nmId,
        startDate: input.currentPeriod.start,
        endDate: input.currentPeriod.end,
        schemaVersion: input.schemaVersion,
        advertId: input.advertId,
        clusterKey: input.clusterKey,
      });
      if (exactResult) {
        return exactResult;
      }
    }

    // SQL-direct fast path: запросы кластера не зависят от диапазона дат —
    // структура кластеров хранится как текущий срез. Возвращаем напрямую.
    // clusterKey = "${advertId}:${normalizedClusterName}"
    const colonIdx = input.clusterKey.indexOf(":");
    const normalizedClusterName = colonIdx >= 0 ? input.clusterKey.slice(colonIdx + 1) : input.clusterKey;

    const sqlQueries = await this.wbClustersRepository.getWorkspaceClusterQueriesSQL(
      input.nmId,
      input.advertId,
      normalizedClusterName,
    );

    if (sqlQueries.queries.length > 0) {
      return {
        nmId: input.nmId,
        startDate: input.currentPeriod?.start ?? "",
        endDate: input.currentPeriod?.end ?? "",
        schemaVersion: input.schemaVersion,
        advertId: input.advertId,
        clusterKey: input.clusterKey,
        clusterName: normalizedClusterName,
        payload: sqlQueries,
        syncedAt: new Date().toISOString(),
      };
    }

    // Нет данных ни в SQL, ни в снапшоте — CTE-fallback на ближайший период.
    const preferredSummary = await this.resolvePreferredSnapshotSummary(input);
    if (!preferredSummary) {
      return null;
    }

    return this.productWorkspaceRepository.getWorkspaceClusterQueries({
      nmId: input.nmId,
      startDate: preferredSummary.startDate,
      endDate: preferredSummary.endDate,
      schemaVersion: preferredSummary.schemaVersion,
      advertId: input.advertId,
      clusterKey: input.clusterKey,
    });
  }

  private async resolvePreferredSnapshotSummary(input: {
    nmId: number;
    currentPeriod?: { start: string; end: string } | null;
    schemaVersion: number;
  }): Promise<PreferredProductAdvertisingSnapshotSummaryRecord | null> {
    if (!input.currentPeriod) {
      const mostRecentSummary =
        await this.productAdvertisingSnapshotRepository.getMostRecentReadySnapshotSummary(input.nmId);
      if (!mostRecentSummary) {
        return null;
      }

      return {
        ...mostRecentSummary,
        fit: "most_recent",
        source: "most_recent_snapshot",
      };
    }

    const [preferredSummary] =
      await this.productAdvertisingSnapshotRepository.getPreferredReadySnapshotSummariesForRange({
        nmIds: [input.nmId],
        startDate: input.currentPeriod.start,
        endDate: input.currentPeriod.end,
        schemaVersion: input.schemaVersion,
      });

    return preferredSummary ?? null;
  }

  /**
   * Fast workspace shell — no PATH B.
   *
   * When no stored workspace snapshot exists yet, instead of running the full
   * PATH B materialization synchronously (which can take 30-120 seconds and
   * blocks the HTTP response), we build a minimal shell directly from
   * wb_campaigns + wb_product_catalog. Both tables are tiny and indexed.
   *
   * The shell provides campaign tabs so the UI renders immediately. The caller
   * is responsible for triggering PATH B in the background so subsequent
   * cluster-table requests get a cache hit.
   */
  private async buildFallbackWorkspaceResponse(input: {
    nmId: number;
    currentPeriod?: { start: string; end: string } | null;
    schemaVersion: number;
    currentRefresh: {
      syncRunId: string;
      startedAt: string;
    } | null;
  }): Promise<ProductAdvertisingWorkspaceResponse> {
    const [campaigns, productCatalogItem] = await Promise.all([
      this.wbClustersRepository.getProductCampaignSummaries(input.nmId),
      this.wbClustersRepository.getProductCatalogItemByNmId(input.nmId),
    ]);

    const emptyTotals = {
      spend: null,
      orders: null,
      clicks: null,
      views: null,
      addToCart: null,
      ctr: null,
      ctc: null,
      cto: null,
      cpc: null,
      cpm: null,
      cpo: null,
      viewToOrder: null,
      activeCount: 0,
      excludedCount: 0,
    };

    const campaignTabs: ProductAdvertisingWorkspaceCampaignTab[] = campaigns.map((c) => ({
      advertId: c.advertId,
      campaignName: c.name,
      campaignStatus: c.campaignStatus,
      paymentType: c.paymentType,
      bidType: c.bidType,
      currency: c.currency,
      syncedAt: c.syncedAt,
      rowsCount: 0,
      totals: emptyTotals,
    }));

    const defaultCampaignId = campaignTabs[0]?.advertId ?? null;
    const now = new Date().toISOString();

    return {
      nmId: input.nmId,
      checkedAt: now,
      readiness: {
        scope: "workspace",
        status: "ready",
        source: "workspace_snapshot",
        materializationStatus: "pending",
      },
      header: {
        nmId: input.nmId,
        vendorCode: productCatalogItem?.vendorCode ?? null,
        productName: productCatalogItem?.name ?? null,
        brandName: productCatalogItem?.brandName ?? null,
        subjectName: productCatalogItem?.subjectName ?? null,
      },
      snapshot: {
        status: "missing" as const,
        fit: "unavailable" as const,
        source: "snapshot_store" as const,
        builtAt: null,
        requestedStartDate: input.currentPeriod?.start ?? null,
        requestedEndDate: input.currentPeriod?.end ?? null,
        snapshotStartDate: null,
        snapshotEndDate: null,
        builtFromExportRequestId: null,
        lastError: null,
      },
      range: {
        startDate: input.currentPeriod?.start ?? null,
        endDate: input.currentPeriod?.end ?? null,
        jamIncluded: false,
        jamStatus: "not_requested" as const,
      },
      dateBounds: {
        minDate: null,
        maxDate: null,
        defaultStartDate: input.currentPeriod?.start ?? null,
        defaultEndDate: input.currentPeriod?.end ?? null,
      },
      campaignTabs,
      defaultCampaignId,
      selectedCampaignSummary:
        campaignTabs.find((t) => t.advertId === defaultCampaignId) ?? null,
      initialClusterTable: null,
      syncState: {
        hasPendingClusterSync: false,
        refreshStatus: input.currentRefresh ? "running" : "idle",
        syncRunId: input.currentRefresh?.syncRunId ?? null,
        startedAt: input.currentRefresh?.startedAt ?? null,
      },
      diagnostics: {
        periodMetricsStatus: "unavailable",
        periodMetricsActualStartDate: null,
        periodMetricsActualEndDate: null,
        dailyStatsWindowStartDate: null,
        dailyStatsWindowEndDate: null,
        queryCoverageStatus: "no-clusters",
      },
    };
  }

  async saveWorkspaceCampaignRows(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
    advertId: number;
    payload: import("./product-workspace-snapshot.types").ProductAdvertisingWorkspaceCampaignRowsSnapshot;
  }): Promise<void> {
    await this.productWorkspaceRepository.replaceWorkspaceCampaignRows(input);
  }

  async invalidateWorkspaceCampaignRows(nmId: number): Promise<void> {
    await this.productWorkspaceRepository.deleteWorkspaceCampaignRowsForNmId(nmId);
  }
}
