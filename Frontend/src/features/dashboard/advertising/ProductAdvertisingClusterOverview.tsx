import { useCallback, useEffect, useState } from "react";

import { formatMoney } from "../../../formatters";
import { ui } from "../copy";
import { useProductMaxCpo } from "../useProductMaxCpo";
import { ProductAdvertisingAutomationPanel } from "./ProductAdvertisingAutomationPanel";
import { useClusterAutomation } from "./useClusterAutomation";
import { ProductAdvertisingDateFilter } from "./ProductAdvertisingDateFilter";
import { ProductAdvertisingChangeLogPanel } from "./ProductAdvertisingChangeLogPanel";
import { ProductAdvertisingFilterSettingsModal } from "./ProductAdvertisingFilterSettingsModal";
import { ProductAdvertisingReviewModal } from "./ProductAdvertisingReviewModal";
import type { ProductAdvertisingClusterTableSectionProps } from "./ProductAdvertisingClusterTableSection";
import {
  getAdvertisingCampaignLabel,
  getAdvertisingCampaignStatusTone,
} from "./clusterTableView";
import { formatAdvertisingCampaignStatus, isAdvertisingCampaignArchived } from "./model";

function getPlacementsLabel(
  placementsSearch: boolean | null | undefined,
  placementsRecommendations: boolean | null | undefined,
): string | null {
  const search = placementsSearch === true;
  const rec = placementsRecommendations === true;
  if (search && rec) return "Поиск+Рекомендации";
  if (search) return "Поиск";
  if (rec) return "Рекомендации";
  // null только когда оба значения неизвестны. Если хотя бы одно явно известно
  // (false), площадки заданы, но ни одна не включена — это не "неизвестно".
  if (
    (placementsSearch === null || placementsSearch === undefined) &&
    (placementsRecommendations === null || placementsRecommendations === undefined)
  ) {
    return null;
  }
  return "Без площадок";
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
  const [isActiveExpanded, setIsActiveExpanded] = useState(true);
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false);
  const [isChangeLogOpen, setIsChangeLogOpen] = useState(false);
  const [isFilterSettingsOpen, setIsFilterSettingsOpen] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const hasSelectedCampaign = props.selectedCampaignAdvertId !== null;

  const handleOpenChangeLog = useCallback(() => setIsChangeLogOpen(true), []);
  const handleCloseChangeLog = useCallback(() => setIsChangeLogOpen(false), []);
  const handleOpenFilterSettings = useCallback(() => setIsFilterSettingsOpen(true), []);
  const handleCloseFilterSettings = useCallback(() => setIsFilterSettingsOpen(false), []);
  const handleOpenReview = useCallback(() => setIsReviewOpen(true), []);
  const handleCloseReview = useCallback(() => setIsReviewOpen(false), []);

  // Планка CPO товара (= CPO × 2, считается на бэке) — на одной линии с «Активные».
  const { maxCpo } = useProductMaxCpo(props.nmId);

  // Автоматизация управления кластерами по CPO для выбранной (активной) кампании.
  const automationAdvertId = props.selectedCampaignAdvertId;
  const {
    status: automation,
    isBusy: automationBusy,
    setMode: setAutomationMode,
    reviewCluster,
  } = useClusterAutomation(props.nmId, automationAdvertId);
  const autoCounts = {
    active: automation.clusters.filter(
      (c) => c.state === "active" || c.state === "manual_protected" || c.state === "protected",
    ).length,
    high: automation.clusters.filter((c) => c.state === "excluded_high").length,
    dropped: automation.clusters.filter((c) => c.state === "dropped").length,
    protected: automation.clusters.filter((c) => c.state === "protected").length,
    blacklisted: automation.clusters.filter((c) => c.state === "blacklisted").length,
  };

  // Close panel when campaign changes
  useEffect(() => {
    setIsChangeLogOpen(false);
  }, [props.selectedCampaignAdvertId]);

  // Группировка "Активные" = НЕ архивные (вкл. кампании на паузе, статус 11).
  // Реальный статус каждой кампании виден по цветной точке/тултипу карточки
  // (formatAdvertisingCampaignStatus), поэтому пауза тут не теряется.
  const activeCampaigns: typeof props.campaignSummaries = [];
  const archivedCampaigns: typeof props.campaignSummaries = [];
  for (const item of props.campaignSummaries) {
    if (isAdvertisingCampaignArchived(item.campaignStatus)) {
      archivedCampaigns.push(item);
    } else {
      activeCampaigns.push(item);
    }
  }

  const isSelectedCampaignArchived =
    props.selectedCampaignAdvertId !== null &&
    archivedCampaigns.some((item) => item.advertId === props.selectedCampaignAdvertId);

  useEffect(() => {
    if (isSelectedCampaignArchived) {
      setIsArchivedExpanded(true);
    }
  }, [isSelectedCampaignArchived]);

  const renderCampaignCard = (item: typeof props.campaignSummaries[number]) => (
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
          {(getPlacementsLabel(item.placementsSearch, item.placementsRecommendations) ?? getBidTypeLabel(item.bidType)) && (
            <span style={{ display: "block", fontSize: "10px", fontWeight: 400, lineHeight: 1.2, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {[getPlacementsLabel(item.placementsSearch, item.placementsRecommendations), getBidTypeLabel(item.bidType)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </span>
      </button>
    </div>
  );

  return (
    <>
      <div className="wb-card-header wb-advertising-section-header" style={{ position: "relative" }}>
        <div>
          <h3>{ui.campaignOverviewTitle}</h3>
        </div>
        {/* Блок «Макс. CPO + панель автоматизации» якорим к верхнему-правому краю
            шапки секции: справа от заголовка пусто, поэтому вся панель (счётчики +
            кнопка) помещается даже при одной активной РК без архивных кампаний.
            Абсолютное позиционирование → рост панели не сдвигает список РК ниже. */}
        {activeCampaigns.length > 0 && (
          <div style={{ position: "absolute", top: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
            {maxCpo !== null && (
              <span
                title="Максимальная планка CPO для ставок кластеров = CPO × 2"
                style={{ fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", color: "var(--wb-text-main)" }}
              >
                Макс. CPO: {formatMoney(maxCpo)}
              </span>
            )}
            {automationAdvertId !== null && (
              <ProductAdvertisingAutomationPanel
                mode={automation.mode}
                counts={autoCounts}
                busy={automationBusy}
                pendingCount={automation.pendingCount}
                onReview={handleOpenReview}
                onToggle={(enabled) => setAutomationMode(enabled ? "preview" : "off")}
                actions={
                  <button
                    type="button"
                    disabled={automationBusy}
                    onClick={() => setAutomationMode(automation.mode === "live" ? "preview" : "live")}
                    style={{ fontSize: "11px", padding: "2px 8px", cursor: "pointer", border: "1px solid var(--wb-border, #ddd)", borderRadius: "6px", background: automation.mode === "live" ? "#fff" : "#1f8a4c", color: automation.mode === "live" ? "var(--wb-text-main)" : "#fff" }}
                  >
                    {automation.mode === "live" ? "В предпросмотр" : "Включить автоматизацию"}
                  </button>
                }
              />
            )}
          </div>
        )}
      </div>

      <div className="wb-advertising-campaign-grid">
        {activeCampaigns.length > 0 && (
          <div style={{ width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "8px" }}>
              <button
                type="button"
                className="wb-advertising-cluster-toggle__arrow-button"
                style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600, fontSize: "12px", color: "var(--wb-text-main)" }}
                onClick={() => setIsActiveExpanded(!isActiveExpanded)}
              >
                <svg
                  className="wb-advertising-cluster-toggle__arrow"
                  style={{ transform: isActiveExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }}
                  width="10" height="10" viewBox="0 0 10 10" fill="none"
                >
                  <path d="M3.5 2L7 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Активные ({activeCampaigns.length})
              </button>
            </div>
            {isActiveExpanded && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px", marginLeft: "16px" }}>
                {activeCampaigns.map(renderCampaignCard)}
              </div>
            )}
          </div>
        )}

        {archivedCampaigns.length > 0 && (
          <div style={{ width: "100%", marginTop: activeCampaigns.length > 0 ? "12px" : 0 }}>
            <button
              type="button"
              className="wb-advertising-cluster-toggle__arrow-button"
              style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px", fontWeight: 600, fontSize: "12px", color: "var(--wb-text-main)" }}
              onClick={() => setIsArchivedExpanded(!isArchivedExpanded)}
            >
              <svg
                className="wb-advertising-cluster-toggle__arrow"
                style={{ transform: isArchivedExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }}
                width="10" height="10" viewBox="0 0 10 10" fill="none"
              >
                <path d="M3.5 2L7 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Архивированные ({archivedCampaigns.length})
            </button>
            {isArchivedExpanded && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px", marginLeft: "16px" }}>
                {archivedCampaigns.map(renderCampaignCard)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="wb-advertising-toolbar">
        {hasSelectedCampaign ? (
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
            <button
              className={`wb-toggle-pill wb-toggle-pill--compact wb-toggle-pill--history${isFilterSettingsOpen ? " active" : ""}`}
              type="button"
              onClick={handleOpenFilterSettings}
              title="Защищённые кластеры и фильтры автоматизации"
            >
              Настройка фильтров
            </button>
            <button
              className={`wb-toggle-pill wb-toggle-pill--compact wb-toggle-pill--history${isChangeLogOpen ? " active" : ""}`}
              type="button"
              onClick={handleOpenChangeLog}
              title="История изменений кластеров"
            >
              История изменений
            </button>
          </div>
        ) : (
          <div />
        )}
        {hasSelectedCampaign && props.canSubmitClusterAction ? (
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

      {isChangeLogOpen &&
        props.selectedCampaignAdvertId !== null &&
        props.nmId !== null && (
          <ProductAdvertisingChangeLogPanel
            nmId={props.nmId}
            advertId={props.selectedCampaignAdvertId}
            onClose={handleCloseChangeLog}
          />
        )}

      {isFilterSettingsOpen &&
        props.selectedCampaignAdvertId !== null &&
        props.nmId !== null && (
          <ProductAdvertisingFilterSettingsModal
            nmId={props.nmId}
            advertId={props.selectedCampaignAdvertId}
            onClose={handleCloseFilterSettings}
          />
        )}

      {isReviewOpen && (
        <ProductAdvertisingReviewModal
          status={automation}
          busy={automationBusy}
          onReview={reviewCluster}
          onClose={handleCloseReview}
        />
      )}
    </>
  );
}
