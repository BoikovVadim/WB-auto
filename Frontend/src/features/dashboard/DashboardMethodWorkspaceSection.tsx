import { useEffect } from "react";

import type {
  ExportMethodStatus,
  SearchQueriesExportPayload,
  SearchQueryProduct,
  SyncEntity,
  WbExportJobResponse,
  WbExportListItem,
  WbExportResponse,
} from "../../api/syncClient";
import { ui } from "./copy";
import {
  advertisingUxBudgetsMs,
  startAdvertisingUxBudget,
} from "./advertising/advertisingUxBudgets";
import {
  formatDateTime,
  formatPeriod,
} from "./dashboardSectionHelpers";
import { DashboardCooldownStatus } from "./DashboardCooldownStatus";
import { MethodWorkspace } from "./MethodWorkspace";
import { MetricCard } from "./MetricCard";

type DashboardMethodWorkspaceSectionProps = {
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
  onBackToMethods: () => void;
  onRunExport: (entityType: SyncEntity) => void | Promise<void>;
  onPrefetchSavedExport: (entityType: SyncEntity, requestId: string) => void;
  onOpenExport: (entityType: SyncEntity, requestId: string) => void | Promise<void>;
  onSelectProduct: (value: number) => void;
};

export function DashboardMethodWorkspaceSection(
  props: DashboardMethodWorkspaceSectionProps,
) {
  const currentMethod = props.currentMethod;
  const currentExportRequestId = props.currentExport?.requestId ?? null;
  const isActiveExportJobVisible =
    props.activeExportJob !== null &&
    props.activeExportJob.entityType === props.selectedMethodEntity;
  const visibleExportJob = isActiveExportJobVisible ? props.activeExportJob : null;
  useEffect(() => {
    if (!currentExportRequestId) {
      return;
    }

    startAdvertisingUxBudget(
      `method-table:${currentExportRequestId}`,
      "method workspace table visible",
      advertisingUxBudgetsMs.methodTableVisible,
    );
  }, [currentExportRequestId]);

  return (
    <section className="wb-card wb-card--wide">
      <div className="wb-method-overview">
        <div className="wb-method-overview-main">
          <div>
            <h2>{currentMethod?.title ?? ui.exportsWorkspace}</h2>
            <p className="wb-card-meta">
              {currentMethod?.description ?? ui.workspaceText}
            </p>
          </div>
          <div className="wb-inline-badges">
            <button
              className="wb-secondary-button"
              onClick={props.onBackToMethods}
            >
              {ui.backToMethods}
            </button>
            <button
              className="wb-primary-button"
              disabled={
                props.isExportLoading ||
                isActiveExportJobVisible ||
                !props.selectedMethodEntity ||
                Boolean(currentMethod?.cooldown.isActive)
              }
              onClick={() => {
                if (props.selectedMethodEntity) {
                  void props.onRunExport(props.selectedMethodEntity);
                }
              }}
            >
              {props.isExportLoading || isActiveExportJobVisible ? ui.runningExport : ui.runExport}
            </button>
          </div>
        </div>

        {currentMethod ? (
          <div className="wb-method-overview-metrics">
            <DashboardCooldownStatus nextAvailableAt={currentMethod.cooldown.nextAvailableAt}>
              {({ label, value }) => <MetricCard label={label} value={value} />}
            </DashboardCooldownStatus>
            <MetricCard
              label={ui.lastAttempt}
              value={
                currentMethod.lastAttemptAt
                  ? formatDateTime(currentMethod.lastAttemptAt)
                  : "-"
              }
            />
            <MetricCard
              label={ui.lastSuccess}
              value={
                currentMethod.lastSuccessAt
                  ? formatDateTime(currentMethod.lastSuccessAt)
                  : "-"
              }
            />
            <MetricCard
              label={ui.lastError}
              value={currentMethod.lastErrorMessage ?? "-"}
            />
          </div>
        ) : null}

        <div className="wb-method-overview-archive">
          {props.methodArchive.length > 0 ? (
            props.methodArchive.map((item) => (
              <button
                key={item.requestId}
                className={`wb-archive-item ${props.selectedExportId === item.requestId ? "active" : ""}`}
                onMouseEnter={() =>
                  props.onPrefetchSavedExport(item.entityType, item.requestId)
                }
                onFocus={() =>
                  props.onPrefetchSavedExport(item.entityType, item.requestId)
                }
                onClick={() => {
                  if (props.selectedMethodEntity) {
                    void props.onOpenExport(props.selectedMethodEntity, item.requestId);
                  }
                }}
              >
                <span className="wb-archive-item-title">{formatPeriod(item.period)}</span>
                <span className="wb-archive-item-meta">
                  {`${item.productsCount} | ${item.searchTextsCount}`}
                </span>
                <span className="wb-archive-item-meta">
                  {formatDateTime(item.exportedAt)}
                </span>
              </button>
            ))
          ) : (
            <p className="wb-empty-copy">{ui.archiveEmpty}</p>
          )}
        </div>
      </div>

      <div className="wb-main-card wb-main-card--method">
        {visibleExportJob ? (
          <div className="wb-empty-copy">
            <strong>{getExportJobStatusLabel(visibleExportJob.status)}</strong>
            <div>{getExportJobStatusMessage(visibleExportJob)}</div>
          </div>
        ) : null}
        {props.isArchiveLoading &&
        (!props.currentExport ||
          props.currentExport.entityType !== props.selectedMethodEntity) ? (
          <p className="wb-empty-copy">{ui.loading}</p>
        ) : !isActiveExportJobVisible && props.currentExport && props.displayPayload ? (
          <MethodWorkspace
            exportRequestId={props.currentExport.requestId}
            exportedAtLabel={formatDateTime(props.currentExport.exportedAt)}
            periodLabel={formatPeriod(props.displayPayload.period)}
            rawArchivePath={props.currentExport.requestMeta.rawArchivePath ?? null}
            payload={props.displayPayload}
            renderRawTables={props.isMethodTablesReady}
            selectedProductNmId={props.selectedProductNmId}
            onSelectProduct={props.onSelectProduct}
            selectedProduct={props.selectedProduct}
          />
        ) : isActiveExportJobVisible ? null : (
          <p className="wb-empty-copy">{ui.archiveEmpty}</p>
        )}
      </div>
    </section>
  );
}

function getExportJobStatusLabel(status: WbExportJobResponse["status"]) {
  switch (status) {
    case "queued":
      return ui.exportQueuedTitle;
    case "running":
      return ui.exportRunningTitle;
    case "failed":
      return ui.exportFailedTitle;
    case "succeeded":
      return ui.exportCompletedTitle;
  }
}

function getExportJobStatusMessage(job: WbExportJobResponse) {
  if (job.status === "failed") {
    return job.errorMessage ?? ui.exportFailedMessage;
  }

  if (job.status === "succeeded") {
    return ui.exportCompletedMessage;
  }

  const periodLabel = job.requestMeta.period ? formatPeriod(job.requestMeta.period) : null;
  const baseMessage =
    job.status === "running" ? ui.exportRunningMessage : ui.exportQueuedMessage;
  return periodLabel
    ? `${baseMessage} ${periodLabel}.`
    : baseMessage;
}
