import { Inject, Injectable } from "@nestjs/common";

import {
  buildClusterQuerySearchIndex,
  buildWorkspaceClusterKey,
} from "./product-workspace-cluster-table.filters";
import { mergeWorkspaceClusters, projectWorkspaceClustersForRange } from "./product-workspace.builder";
import { buildProductAdvertisingWorkspaceResponse } from "./product-workspace.builder.core";
import {
  isWorkspaceClusterActive,
  isWorkspaceClusterExcluded,
} from "./product-workspace.builder.sources";
import type {
  ProductAdvertisingClusterQuery,
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingSheetResponse,
} from "./wb-clusters.types";
import { ProductWorkspaceRepository } from "./product-workspace.repository";
import { WbClustersRepository } from "./wb-clusters.repository";
import {
  type ProductAdvertisingWorkspaceCampaignRowsSnapshot,
} from "./product-workspace-snapshot.types";

@Injectable()
export class ProductWorkspaceSnapshotMaterializer {
  constructor(
    @Inject(ProductWorkspaceRepository)
    private readonly productWorkspaceRepository: ProductWorkspaceRepository,
    @Inject(WbClustersRepository)
    private readonly wbClustersRepository: WbClustersRepository,
  ) {}

  async materializeFromProductSheetSnapshot(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
    sheet: ProductAdvertisingSheetResponse;
  }) {
    const productCatalogItem = await this.wbClustersRepository.getProductCatalogItemByNmId(input.nmId);
    const workspaceShell = buildProductAdvertisingWorkspaceResponse({
      sheet: input.sheet,
      productCatalogItem,
      currentRefresh: null,
      readiness: {
        scope: "workspace",
        status: "ready",
        source: "workspace_snapshot",
        materializationStatus: "materialized",
      },
    });

    const campaignSnapshots = buildWorkspaceCampaignSnapshots(input.sheet);
    for (const [advertId, payload] of campaignSnapshots) {
      await this.productWorkspaceRepository.replaceWorkspaceCampaignRows({
        nmId: input.nmId,
        startDate: input.startDate,
        endDate: input.endDate,
        schemaVersion: input.schemaVersion,
        advertId,
        payload,
      });
    }

    const queryGroupSnapshots = buildWorkspaceClusterQuerySnapshots(input.sheet);
    // Один батчевый INSERT вместо N последовательных round-trip'ов.
    await this.productWorkspaceRepository.batchReplaceWorkspaceClusterQueries({
      nmId: input.nmId,
      startDate: input.startDate,
      endDate: input.endDate,
      schemaVersion: input.schemaVersion,
      groups: queryGroupSnapshots.map((group) => ({
        advertId: group.advertId,
        clusterKey: group.clusterKey,
        clusterName: group.clusterName,
        payload: {
          checkedAt: input.sheet.checkedAt,
          queries: group.queries,
        },
      })),
    });

    // Persist the shell last so a visible shell implies detail slices
    // for the same nmId/range/schema are already materialized.
    await this.productWorkspaceRepository.replaceWorkspaceSnapshot({
      nmId: input.nmId,
      startDate: input.startDate,
      endDate: input.endDate,
      schemaVersion: input.schemaVersion,
      payload: workspaceShell,
    });

    return workspaceShell;
  }
}

function buildWorkspaceCampaignSnapshots(sheet: ProductAdvertisingSheetResponse) {
  const mergedClusters = mergeWorkspaceClusters(sheet.clusters);
  const projectedRows = projectWorkspaceClustersForRange(mergedClusters, sheet).map((row) => ({
    ...row,
    clusterKey: buildWorkspaceClusterKey(row.advertId, row.clusterName),
  })) as ProductAdvertisingWorkspaceClusterRow[];
  const rowsByAdvertId = new Map<number, ProductAdvertisingWorkspaceClusterRow[]>();

  for (const row of projectedRows) {
    if (row.advertId === null) {
      continue;
    }

    // Only store explicitly managed clusters; stats-only gray clusters are excluded.
    if (!isWorkspaceClusterActive(row) && !isWorkspaceClusterExcluded(row)) {
      continue;
    }

    const currentRows = rowsByAdvertId.get(row.advertId);
    if (currentRows) {
      currentRows.push(row);
      continue;
    }

    rowsByAdvertId.set(row.advertId, [row]);
  }

  const snapshots = new Map<number, ProductAdvertisingWorkspaceCampaignRowsSnapshot>();
  for (const campaign of sheet.campaigns) {
    const advertId = campaign.advertId;
    const rows = rowsByAdvertId.get(advertId) ?? [];
    snapshots.set(advertId, {
      checkedAt: sheet.checkedAt,
      rows,
      filterCounts: {
        all: rows.length,
        active: rows.filter((row) => row.sourceKind === "active" && row.isActive !== false).length,
        excluded: rows.filter((row) => row.sourceKind === "excluded" || row.isActive === false).length,
      },
      // querySearchIndex is NOT persisted to DB — it can be several MB of JSON per product
      // (190k+ queries × token mappings) which causes seconds of parse overhead on every read.
      // The in-memory read-model cache (productAdvertisingSheetReadModelCache) holds the full
      // index and is used by getProductAdvertisingWorkspaceClusterTable when search != "".
      querySearchIndex: {},
    });
  }

  return snapshots;
}

function buildWorkspaceClusterQuerySnapshots(sheet: ProductAdvertisingSheetResponse) {
  const groups = new Map<
    string,
    {
      advertId: number;
      clusterKey: string;
      clusterName: string;
      queries: ProductAdvertisingClusterQuery[];
      queryKeys: Set<string>;
    }
  >();

  for (const query of sheet.clusterQueries) {
    if (query.advertId === null || !query.isCanonicalClusterQuery) {
      continue;
    }

    const clusterKey = buildWorkspaceClusterKey(query.advertId, query.clusterName);
    const uniqueQueryKey = query.queryText.trim().toLocaleLowerCase("ru");
    let currentGroup = groups.get(clusterKey);
    if (!currentGroup) {
      currentGroup = {
        advertId: query.advertId,
        clusterKey,
        clusterName: query.clusterName,
        queries: [],
        queryKeys: new Set<string>(),
      };
      groups.set(clusterKey, currentGroup);
    }

    if (currentGroup.queryKeys.has(uniqueQueryKey)) {
      continue;
    }

    currentGroup.queryKeys.add(uniqueQueryKey);
    currentGroup.queries.push(query);
  }

  return Array.from(groups.values()).map((group) => ({
    advertId: group.advertId,
    clusterKey: group.clusterKey,
    clusterName: group.clusterName,
    queries: group.queries,
  }));
}
