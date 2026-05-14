import { useMemo } from "react";

import { ui } from "../copy";
import { ProductAdvertisingDateFilter } from "./ProductAdvertisingDateFilter";
import type { ProductAdvertisingClusterTableSectionProps } from "./ProductAdvertisingClusterTableSection";
import {
  getAdvertisingCampaignLabel,
  getAdvertisingCampaignStatusTone,
} from "./clusterTableView";
import { formatAdvertisingCampaignStatus } from "./model";

const CAMPAIGN_TYPE_LABEL: Record<number, string> = {
  4: "Каталог",
  5: "Карточка",
  6: "Поиск",
  7: "Рекомендации",
  8: "Авто",
  9: "Поиск+Каталог",
};

function getCampaignTypeLabel(campaignType: number | null | undefined): string | null {
  return campaignType != null ? (CAMPAIGN_TYPE_LABEL[campaignType] ?? null) : null;
}

function getBidTypeLabel(bidType: string | null): string | null {
  if (bidType === "manual") return "Ручная";
  if (bidType === "unified") return "Единая";
  if (bidType === "auto") return "Авто";
  if (bidType === "auction") return "Аукцион";
  return null;
}

/**
 * Builds the correct WB campaign deep-link.
 * Format verified from real WB URLs:
 *   https://cmp.wildberries.ru/campaigns/edit/{advertId}?advertID={advertId}&nmId={nmId}
 */
function buildCampaignUrl(advertId: number, nmId: number | null): string {
  const base = `https://cmp.wildberries.ru/campaigns/edit/${String(advertId)}`;
  const params = new URLSearchParams({ advertID: String(advertId) });
  if (nmId !== null) {
    params.set("nmId", String(nmId));
  }
  return `${base}?${params.toString()}`;
}

function getCampaignStatusPriority(status: number | null): number {
  if (status === 9) return 0;  // active / running
  if (status === 11) return 1; // paused
  return 2;                    // disabled / excluded
}

type ProductAdvertisingClusterOverviewProps = Pick<
  ProductAdvertisingClusterTableSectionProps,
  | "nmId"
  | "campaignSummaries"
  | "selectedCampaignAdvertId"
  | "onSelectCampaign"
  | "onCampaignHover"
  | "statusFilter"
  | "onStatusFilterChange"
  | "clusterFilterCounts"
  | "canSubmitClusterAction"
  | "selectedExcludedClustersCount"
  | "selectedActiveClustersCount"
  | "isClusterActionSubmitting"
  | "hasSelectedPendingClusterActions"
  | "onApplyClusterAction"
  | "dateRange"
  | "clusterDailyStatsBounds"
  | "onDateRangeChange"
  | "onPresetHover"
  | "diagnostics"
  | "bidErrorMessage"
  | "clusterActionErrorMessage"
  | "pagination"
  | "onPageChange"
  | "isAdvertisingSyncStarting"
  | "onRunAdvertisingSync"
  | "onReloadAdvertising"
>;

export function ProductAdvertisingClusterOverview(
  props: ProductAdvertisingClusterOverviewProps,
) {
  const sortedCampaigns = useMemo(
    () =>
      [...props.campaignSummaries].sort(
        (a, b) =>
          getCampaignStatusPriority(a.campaignStatus) -
          getCampaignStatusPriority(b.campaignStatus),
      ),
    [props.campaignSummaries],
  );

  return (
    <>
      <div className="wb-card-header wb-advertising-section-header">
        <div>
          <h3>{ui.campaignOverviewTitle}</h3>
        </div>
      </div>

      <div className="wb-advertising-campaign-grid">
        {sortedCampaigns.map((item) => (
          <div key={item.advertId} className="wb-advertising-campaign-card-wrap">
            <a
              href={buildCampaignUrl(item.advertId, props.nmId)}
              target="_blank"
              rel="noopener noreferrer"
              className="wb-advertising-campaign-wb-link"
              title="Открыть РК на Wildberries"
              aria-label="Открыть РК на Wildberries"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M10 7.5V10.5C10 10.776 9.776 11 9.5 11H1.5C1.224 11 1 10.776 1 10.5V2.5C1 2.224 1.224 2 1.5 2H4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <path d="M7 1H11V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M11 1L5.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </a>
            <button
              className={`wb-advertising-campaign-card ${
                props.selectedCampaignAdvertId === item.advertId
                  ? "wb-advertising-campaign-card--active"
                  : ""
              }`}
              type="button"
              onClick={() => props.onSelectCampaign(item.advertId)}
              onMouseEnter={() => props.onCampaignHover?.(item.advertId)}
            >
              <span
                className={`wb-advertising-status-dot wb-advertising-status-dot--${getAdvertisingCampaignStatusTone(item.campaignStatus)}`}
                aria-label={formatAdvertisingCampaignStatus(item.campaignStatus)}
                title={formatAdvertisingCampaignStatus(item.campaignStatus)}
                style={{ flexShrink: 0 }}
              />
              <span style={{ minWidth: 0, overflow: "hidden" }}>
                <span style={{ display: "block", fontSize: "11px", fontWeight: 600, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {getAdvertisingCampaignLabel(item)}
                </span>
                {(getCampaignTypeLabel(item.campaignType) ?? getBidTypeLabel(item.bidType)) && (
                  <span style={{ display: "block", fontSize: "10px", fontWeight: 400, lineHeight: 1.2, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[getCampaignTypeLabel(item.campaignType), getBidTypeLabel(item.bidType)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </span>
            </button>
          </div>
        ))}
      </div>

      {props.selectedCampaignAdvertId !== null ? (
        <>
          <div className="wb-advertising-toolbar">
            <div className="wb-advertising-filters">
              <button
                className={`wb-toggle-pill wb-toggle-pill--compact ${
                  props.statusFilter === "all" ? "active" : ""
                }`}
                type="button"
                onClick={() => props.onStatusFilterChange("all")}
              >
                {`${ui.allClusters} ${String(props.clusterFilterCounts.all)}`}
              </button>
              <button
                className={`wb-toggle-pill wb-toggle-pill--compact ${
                  props.statusFilter === "active" ? "active" : ""
                }`}
                type="button"
                onClick={() => props.onStatusFilterChange("active")}
              >
                {`${ui.activeClusters} ${String(props.clusterFilterCounts.active)}`}
              </button>
              <button
                className={`wb-toggle-pill wb-toggle-pill--compact ${
                  props.statusFilter === "excluded" ? "active" : ""
                }`}
                type="button"
                onClick={() => props.onStatusFilterChange("excluded")}
              >
                {`${ui.excludedClusters} ${String(props.clusterFilterCounts.excluded)}`}
              </button>
            </div>
            {props.canSubmitClusterAction ? (
              <div className="wb-advertising-actions">
                {props.selectedExcludedClustersCount > 0 ? (
                  <button
                    type="button"
                    className="wb-toggle-pill wb-toggle-pill--compact"
                    onClick={() => props.onApplyClusterAction("include")}
                    disabled={
                      props.isClusterActionSubmitting || props.hasSelectedPendingClusterActions
                    }
                  >
                    {props.hasSelectedPendingClusterActions
                      ? "Ожидание..."
                      : props.isClusterActionSubmitting
                        ? "Применение..."
                        : `Включить ${String(props.selectedExcludedClustersCount)}`}
                  </button>
                ) : null}
                {props.selectedActiveClustersCount > 0 ? (
                  <button
                    type="button"
                    className="wb-toggle-pill wb-toggle-pill--compact"
                    onClick={() => props.onApplyClusterAction("exclude")}
                    disabled={
                      props.isClusterActionSubmitting || props.hasSelectedPendingClusterActions
                    }
                  >
                    {props.hasSelectedPendingClusterActions
                      ? "Ожидание..."
                      : props.isClusterActionSubmitting
                        ? "Применение..."
                        : `Выключить ${String(props.selectedActiveClustersCount)}`}
                  </button>
                ) : null}
              </div>
            ) : null}
            <ProductAdvertisingDateFilter
              dateRange={props.dateRange}
              bounds={props.clusterDailyStatsBounds}
              allowAllPast
              onDateRangeChange={props.onDateRangeChange}
              onPresetHover={props.onPresetHover}
            />
          </div>

          {props.bidErrorMessage ? (
            <p className="wb-advertising-inline-error">{props.bidErrorMessage}</p>
          ) : null}
          {props.clusterActionErrorMessage ? (
            <p className="wb-advertising-inline-error">{props.clusterActionErrorMessage}</p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
