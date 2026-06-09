import type { ReactNode } from "react";

import type {
  ProductAdvertisingClusterQuery,
  ProductAdvertisingWorkspaceClusterRow,
} from "../../../api/syncClient";
import {
  formatMoneyValue,
  formatNullableNumber,
  formatNullablePercent,
  formatPercentRatio,
} from "../formatters/metrics";
import {
  buildAdvertisingClusterGroupKey,
  formatAdvertisingClusterPluralLabel,
  formatAdvertisingClusterQueryCount,
  getAdvertisingClusterQueryCount,
  type AdvertisingClusterSortKey,
} from "./clusterTableView";
import {
  getAdvertisingCpoOrSpend,
  getAdvertisingCpoOrderedItems,
  getAdvertisingOrderedItems,
  isClusterPositionAutoMaintained,
} from "./model";
import { ratio } from "./advertisingClusterTableLayout";
import { ClusterPositionCell } from "./ClusterPositionCell";

export function renderAdvertisingTotalsCell(
  columnKey: AdvertisingClusterSortKey,
  visibleClusterTotals: {
    count: number;
    jamFrequency: number | null;
    jamClicks: number | null;
    jamAddToCart: number | null;
    jamOrders: number | null;
    jamAvgPosition: number | null;
    monthlyFrequency: number | null;
    bid: number | null;
    views: number | null;
    clicks: number | null;
    ctr: number | null;
    addToCart: number | null;
    ctc: number | null;
    orders: number | null;
    cto: number | null;
    avgPosition: number | null;
    cpc: number | null;
    cpm: number | null;
    cpo: number | null;
    viewToOrder: number | null;
    spend: number | null;
    currency: string | null;
    accruedSpend?: number | null;
    accruedOrders?: number | null;
    accruedCpo?: number | null;
    accruedCr?: number | null;
  },
) {
  switch (columnKey) {
    case "clusterName":
      return formatAdvertisingClusterPluralLabel(visibleClusterTotals.count);
    case "bid":
      return formatNullableNumber(visibleClusterTotals.bid);
    case "jamFrequency":
      return formatNullableNumber(visibleClusterTotals.jamFrequency);
    case "jamClicks":
      return formatNullableNumber(visibleClusterTotals.jamClicks);
    case "jamAddToCart":
      return formatNullableNumber(visibleClusterTotals.jamAddToCart);
    case "jamOrders":
      return formatNullableNumber(visibleClusterTotals.jamOrders);
    case "jamAvgPosition":
      return formatNullableNumber(visibleClusterTotals.jamAvgPosition);
    case "jamCtc":
      return formatNullablePercent(
        ratio(visibleClusterTotals.jamAddToCart, visibleClusterTotals.jamClicks),
      );
    case "jamCto":
      return formatNullablePercent(
        ratio(visibleClusterTotals.jamOrders, visibleClusterTotals.jamAddToCart),
      );
    case "monthlyFrequency":
      return formatNullableNumber(visibleClusterTotals.monthlyFrequency);
    case "views":
      return formatNullableNumber(visibleClusterTotals.views);
    case "clicks":
      return formatNullableNumber(visibleClusterTotals.clicks);
    case "ctr":
      return formatNullablePercent(visibleClusterTotals.ctr);
    case "addToCart":
      return formatNullableNumber(visibleClusterTotals.addToCart);
    case "ctc":
      return formatNullablePercent(visibleClusterTotals.ctc);
    case "orders":
      return formatNullableNumber(visibleClusterTotals.orders);
    case "cto":
      return formatNullablePercent(visibleClusterTotals.cto);
    case "avgPosition":
      return formatNullableNumber(visibleClusterTotals.avgPosition);
    case "cpc":
      return formatNullableNumber(visibleClusterTotals.cpc);
    case "cpm":
      return formatNullableNumber(visibleClusterTotals.cpm);
    case "cpo":
      return formatMoneyValue(visibleClusterTotals.cpo, visibleClusterTotals.currency);
    case "viewToOrder":
      return formatNullablePercent(visibleClusterTotals.viewToOrder);
    case "spend":
      return formatMoneyValue(visibleClusterTotals.spend, visibleClusterTotals.currency);
    case "accruedSpend":
      return formatMoneyValue(visibleClusterTotals.accruedSpend ?? null, visibleClusterTotals.currency);
    case "accruedOrders":
      return formatNullableNumber(visibleClusterTotals.accruedOrders ?? null);
    case "accruedCpo":
      return formatMoneyValue(visibleClusterTotals.accruedCpo ?? null, visibleClusterTotals.currency);
    case "accruedCr":
      return formatNullablePercent(visibleClusterTotals.accruedCr ?? null);
    case "productPosition":
      return null;
  }
}

export function renderAdvertisingGroupCell(input: {
  columnKey: AdvertisingClusterSortKey;
  row: ProductAdvertisingWorkspaceClusterRow;
  queries: ProductAdvertisingClusterQuery[];
  isExpanded: boolean;
  copiedClusterKey: string | null;
  onToggleClusterGroup: (clusterKey: string) => void;
  onCopyClusterName: (clusterKey: string, clusterName: string) => void | Promise<void>;
  renderClusterBidCell: (
    row: ProductAdvertisingWorkspaceClusterRow,
    options?: { nested?: boolean; emptyLabel?: string },
  ) => ReactNode;
}) {
  const { columnKey, row, queries } = input;
  const clusterKey = buildAdvertisingClusterGroupKey(row);
  const isExpanded = input.isExpanded;

  switch (columnKey) {
    case "clusterName":
      return (
        <div className="wb-advertising-cluster-toggle">
          <button
            type="button"
            className={`wb-advertising-cluster-toggle__arrow-button${
              isExpanded ? " is-expanded" : ""
            }`}
            onClick={() => input.onToggleClusterGroup(clusterKey)}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? `Свернуть кластер ${row.clusterName}`
                : `Развернуть кластер ${row.clusterName}`
            }
            title={
              isExpanded
                ? `Свернуть кластер ${row.clusterName}`
                : `Развернуть кластер ${row.clusterName}`
            }
          >
            <span className="wb-advertising-cluster-toggle__arrow" aria-hidden="true">
              {isExpanded ? "↓" : "→"}
            </span>
          </button>
          <button
            type="button"
            className={`wb-advertising-cluster-copy-button${
              input.copiedClusterKey === clusterKey
                ? " wb-advertising-cluster-copy-button--copied"
                : ""
            }`}
            onClick={() => {
              void input.onCopyClusterName(clusterKey, row.clusterName);
            }}
            aria-label={`Скопировать название кластера ${row.clusterName}`}
            title={`Скопировать: ${row.clusterName}`}
          >
            {input.copiedClusterKey === clusterKey ? "✓" : "⧉"}
          </button>
          <span className="wb-advertising-cluster-toggle__text" title={row.clusterName}>
            {row.clusterName}
          </span>
          <span className="wb-advertising-cluster-toggle__count">
            {formatAdvertisingClusterQueryCount(getAdvertisingClusterQueryCount(row, queries))}
          </span>
        </div>
      );
    case "bid":
      return input.renderClusterBidCell(row);
    case "jamFrequency":
      return formatNullableNumber(row.jamFrequency);
    case "jamClicks":
      return formatNullableNumber(row.jamClicks);
    case "jamAddToCart":
      return formatNullableNumber(row.jamAddToCart);
    case "jamOrders":
      return formatNullableNumber(row.jamOrders);
    case "jamAvgPosition":
      return formatNullableNumber(row.jamAvgPosition);
    case "jamCtc":
      return formatPercentRatio(row.jamAddToCart, row.jamClicks);
    case "jamCto":
      return formatPercentRatio(row.jamOrders, row.jamAddToCart);
    case "monthlyFrequency":
      return formatNullableNumber(row.monthlyFrequency);
    case "views":
      return formatNullableNumber(row.views);
    case "clicks":
      return formatNullableNumber(row.clicks);
    case "ctr":
      return formatNullablePercent(row.ctr);
    case "addToCart":
      return formatNullableNumber(row.addToCart);
    case "ctc":
      return formatPercentRatio(row.addToCart, row.clicks);
    case "orders":
      return formatNullableNumber(getAdvertisingOrderedItems(row));
    case "cto":
      return formatPercentRatio(getAdvertisingOrderedItems(row), row.addToCart);
    case "avgPosition":
      return formatNullableNumber(row.avgPosition);
    case "cpc":
      return formatNullableNumber(row.cpc);
    case "cpm":
      return formatNullableNumber(row.cpm);
    case "cpo":
      return formatMoneyValue(
        getAdvertisingCpoOrSpend(row.spend, getAdvertisingCpoOrderedItems(row)),
        row.currency,
      );
    case "viewToOrder":
      return formatPercentRatio(getAdvertisingOrderedItems(row), row.views);
    case "spend":
      return formatMoneyValue(row.spend, row.currency);
    case "accruedSpend":
      return formatMoneyValue(row.accruedSpend ?? null, row.currency);
    case "accruedOrders":
      return formatNullableNumber(row.accruedOrders ?? null);
    case "accruedCpo":
      return formatMoneyValue(row.accruedCpo ?? null, row.currency);
    case "accruedCr":
      return formatNullablePercent(row.accruedCr ?? null);
    case "productPosition":
      return (
        <ClusterPositionCell
          clusterName={row.clusterName}
          autoMaintained={isClusterPositionAutoMaintained(row)}
        />
      );
  }
}

export function renderAdvertisingQueryCell(
  columnKey: AdvertisingClusterSortKey,
  row: ProductAdvertisingWorkspaceClusterRow,
  query: ProductAdvertisingClusterQuery,
  renderClusterBidCell: (
    row: ProductAdvertisingWorkspaceClusterRow,
    options?: { nested?: boolean; emptyLabel?: string },
  ) => ReactNode,
  copyOptions?: {
    queryKey: string;
    copiedQueryKey: string | null;
    onCopyQueryText: (queryKey: string, queryText: string) => void | Promise<void>;
  },
) {
  switch (columnKey) {
    case "clusterName": {
      const isCopied = copyOptions !== undefined && copyOptions.copiedQueryKey === copyOptions.queryKey;
      return (
        <span className="wb-advertising-query-indent">
          {copyOptions !== undefined && (
            <button
              type="button"
              className={`wb-advertising-cluster-copy-button${isCopied ? " wb-advertising-cluster-copy-button--copied" : ""}`}
              onClick={() => {
                void copyOptions.onCopyQueryText(copyOptions.queryKey, query.queryText);
              }}
              aria-label={`Скопировать запрос ${query.queryText}`}
              title={`Скопировать: ${query.queryText}`}
            >
              {isCopied ? "✓" : "⧉"}
            </button>
          )}
          <span
            className="wb-advertising-query-indent__text"
            title={query.queryText}
          >
            {query.queryText}
          </span>
        </span>
      );
    }
    case "bid":
      return renderClusterBidCell(row, {
        nested: true,
        emptyLabel: `Для запроса ${query.queryText} отдельная ставка недоступна, меняется ставка всего кластера ${row.clusterName}`,
      });
    case "jamFrequency":
      return formatNullableNumber(query.jamFrequency);
    case "jamClicks":
      return formatNullableNumber(query.jamClicks);
    case "jamAddToCart":
      return formatNullableNumber(query.jamAddToCart);
    case "jamOrders":
      return formatNullableNumber(query.jamOrders);
    case "jamAvgPosition":
      return formatNullableNumber(query.jamAvgPosition);
    case "jamCtc":
      return formatNullablePercent(query.jamOpenToCart);
    case "jamCto":
      return formatPercentRatio(query.jamOrders, query.jamAddToCart);
    case "monthlyFrequency":
      return formatNullableNumber(query.monthlyFrequency);
    case "views":
      return formatNullableNumber(query.views);
    case "clicks":
      return formatNullableNumber(query.clicks);
    case "ctr":
      return formatPercentRatio(query.clicks, query.views);
    case "addToCart":
      return formatNullableNumber(query.addToCart);
    case "ctc":
      return formatPercentRatio(query.addToCart, query.clicks);
    case "orders":
      return formatNullableNumber(getAdvertisingOrderedItems(query));
    case "cto":
      return formatPercentRatio(getAdvertisingOrderedItems(query), query.addToCart);
    case "avgPosition":
    case "cpc":
    case "cpm":
    case "cpo":
    case "spend":
    case "accruedSpend":
    case "accruedOrders":
    case "accruedCpo":
    case "accruedCr":
    case "productPosition":
      return "-";
    case "viewToOrder":
      return formatPercentRatio(getAdvertisingOrderedItems(query), query.views);
  }
}

export function renderEmptyAdvertisingQueryCell(
  columnKey: AdvertisingClusterSortKey,
  message?: string,
) {
  if (columnKey === "clusterName") {
    return (
      <span className="wb-advertising-query-indent wb-advertising-query-indent--empty">
        {message ?? "Для этого кластера пока нет сохраненной карты запросов."}
      </span>
    );
  }

  return null;
}
