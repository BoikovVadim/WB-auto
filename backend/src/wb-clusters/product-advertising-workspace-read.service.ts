import { BadRequestException, Injectable } from "@nestjs/common";

import type {
  ProductAdvertisingWorkspaceCampaignRowsSnapshot,
  ProductAdvertisingWorkspaceClusterQueriesSnapshot,
} from "./product-workspace-snapshot.types";
import {
  normalizeStoredWorkspacePayload,
  normalizeWorkspaceCampaignRowsSnapshot,
  normalizeWorkspaceClusterQueriesSnapshot,
} from "./product-workspace-snapshot.compat";
import { buildProductAdvertisingWorkspaceQueriesResponse } from "./product-workspace-queries.builder";
import { buildProductAdvertisingWorkspaceTableResponse } from "./product-workspace-table.builder";
import { buildProductAdvertisingWorkspaceResponse } from "./product-workspace.builder";
import {
  type ClusterAccrualForRow,
  loadCurrentBucketAccrualForRows,
  mergeAccrualIntoClusterRows,
} from "./wb-clusters-read-flow.accrual-merge";
import { WbClustersRepository } from "./wb-clusters.repository";
import type { ProductAdvertisingWorkspaceClusterNumericFilters } from "./wb-clusters.types";

@Injectable()
export class ProductAdvertisingWorkspaceReadService {
  constructor(private readonly repository: WbClustersRepository) {}

  buildWorkspaceResponse(
    input: Parameters<typeof buildProductAdvertisingWorkspaceResponse>[0],
  ) {
    return buildProductAdvertisingWorkspaceResponse(input);
  }

  normalizeWorkspaceResponse(
    payload: unknown,
    currentRefresh: {
      syncRunId: string;
      startedAt: string;
    } | null,
  ) {
    return normalizeStoredWorkspacePayload({
      payload,
      currentRefresh,
    });
  }

  async buildClusterTableResponse(input: {
    nmId: number;
    snapshot: ProductAdvertisingWorkspaceCampaignRowsSnapshot;
    advertId: number;
    status?: Parameters<typeof buildProductAdvertisingWorkspaceTableResponse>[0]["status"];
    search?: string;
    clusterNameSearch?: string;
    numericFilters?: string;
    sortKey?: Parameters<typeof buildProductAdvertisingWorkspaceTableResponse>[0]["sortKey"];
    sortDirection?: Parameters<typeof buildProductAdvertisingWorkspaceTableResponse>[0]["sortDirection"];
    page?: number;
    pageSize?: number;
  }) {
    const normalizedSnapshot = normalizeWorkspaceCampaignRowsSnapshot(
      input.snapshot,
      input.snapshot.checkedAt,
    );
    // Накопленные данные текущей ценовой корзины (входы движка v2) — для понимания решений.
    // Best-effort: если accrual недоступен, строки получают null и таблица всё равно рисуется.
    let accrual = new Map<string, ClusterAccrualForRow>();
    try {
      accrual = await loadCurrentBucketAccrualForRows(this.repository, input.advertId, input.nmId);
    } catch {
      accrual = new Map();
    }
    const rowsWithAccrual = mergeAccrualIntoClusterRows(normalizedSnapshot.rows, accrual);
    return buildProductAdvertisingWorkspaceTableResponse({
      nmId: input.nmId,
      snapshot: { ...normalizedSnapshot, rows: rowsWithAccrual },
      advertId: input.advertId,
      status: input.status ?? "all",
      search: input.search ?? "",
      clusterNameSearch: input.clusterNameSearch ?? "",
      numericFilters: this.normalizeWorkspaceClusterNumericFilters(input.numericFilters),
      sortKey: input.sortKey ?? "spend",
      sortDirection: input.sortDirection ?? "desc",
      page: input.page ?? 1,
      pageSize: input.pageSize ?? 200,
    });
  }

  normalizeWorkspaceClusterNumericFilters(
    rawValue?: string,
  ): Parameters<typeof buildProductAdvertisingWorkspaceTableResponse>[0]["numericFilters"] {
    return this.parseWorkspaceClusterNumericFilters(rawValue);
  }

  buildClusterQueriesResponse(input: {
    nmId: number;
    snapshot: ProductAdvertisingWorkspaceClusterQueriesSnapshot;
    advertId: number;
    clusterKey?: string;
    clusterName?: string;
    sortKey?: Parameters<typeof buildProductAdvertisingWorkspaceQueriesResponse>[0]["sortKey"];
    sortDirection?: Parameters<typeof buildProductAdvertisingWorkspaceQueriesResponse>[0]["sortDirection"];
    normalizeAdvertisingText: (value: string) => string;
  }) {
    const clusterKey = input.clusterKey?.trim()
      ? input.clusterKey.trim()
      : input.clusterName?.trim()
        ? `${input.advertId}:${input.normalizeAdvertisingText(input.clusterName)}`
        : null;
    if (!clusterKey) {
      throw new BadRequestException("Не передан ключ кластера для загрузки запросов.");
    }

    return buildProductAdvertisingWorkspaceQueriesResponse({
      nmId: input.nmId,
      snapshot: normalizeWorkspaceClusterQueriesSnapshot(input.snapshot, input.snapshot.checkedAt),
      advertId: input.advertId,
      clusterKey,
      clusterName: input.clusterName ?? clusterKey,
      sortKey: input.sortKey ?? "spend",
      sortDirection: input.sortDirection ?? "desc",
    });
  }

  private parseWorkspaceClusterNumericFilters(
    rawValue?: string,
  ): Parameters<typeof buildProductAdvertisingWorkspaceTableResponse>[0]["numericFilters"] {
    const emptyFilters = this.createEmptyWorkspaceClusterNumericFilters();
    if (!rawValue?.trim()) {
      return emptyFilters;
    }

    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(rawValue);
    } catch {
      throw new BadRequestException("Некорректный формат numericFilters для таблицы кластеров.");
    }

    if (typeof parsedValue !== "object" || parsedValue === null) {
      throw new BadRequestException("numericFilters должен быть объектом с min/max значениями.");
    }

    const result: ProductAdvertisingWorkspaceClusterNumericFilters = { ...emptyFilters };
    for (const key of Object.keys(emptyFilters) as Array<keyof typeof emptyFilters>) {
      const entry = (parsedValue as Record<string, unknown>)[key];
      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      result[key] = {
        min: toNullableNumber((entry as Record<string, unknown>).min),
        max: toNullableNumber((entry as Record<string, unknown>).max),
      };
    }

    return result;
  }

  private createEmptyWorkspaceClusterNumericFilters(): ProductAdvertisingWorkspaceClusterNumericFilters {
    return {
      jamFrequency: { min: null, max: null },
      jamClicks: { min: null, max: null },
      jamAddToCart: { min: null, max: null },
      jamOrders: { min: null, max: null },
      jamAvgPosition: { min: null, max: null },
      jamCtc: { min: null, max: null },
      jamCto: { min: null, max: null },
      monthlyFrequency: { min: null, max: null },
      bid: { min: null, max: null },
      views: { min: null, max: null },
      clicks: { min: null, max: null },
      ctr: { min: null, max: null },
      addToCart: { min: null, max: null },
      ctc: { min: null, max: null },
      orders: { min: null, max: null },
      cto: { min: null, max: null },
      avgPosition: { min: null, max: null },
      cpc: { min: null, max: null },
      cpm: { min: null, max: null },
      cpo: { min: null, max: null },
      viewToOrder: { min: null, max: null },
      spend: { min: null, max: null },
    };
  }
}

function toNullableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
