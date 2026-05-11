import { useCallback, useState } from "react";

import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import {
  applyProductAdvertisingClusterBid,
  type ProductAdvertisingSheetResponse,
  type ProductAdvertisingWorkspaceClusterRow,
} from "../../../api/syncClient";
import { ui } from "../copy";
import { getSafeMessage } from "../dashboardErrors";
import { formatNullableNumber } from "../formatters/metrics";
import {
  buildAdvertisingClusterGroupKey,
  canEditAdvertisingClusterBid,
  formatBidDraftValue,
  getBidSyncStatusPresentation,
  normalizeDisplayedBid,
  parseBidDraftValue,
} from "./clusterTableView";
import {
  applyClusterBidResponsePatch,
  applyOptimisticClusterBidPatch,
  captureProductAdvertisingDetailCacheSnapshot,
  restoreProductAdvertisingDetailCacheSnapshot,
} from "./productAdvertisingOptimisticCaches";

export function useAdvertisingClusterBidEditing(input: {
  nmId: number | null;
  requestInput: ProductAdvertisingSheetRequestInput | null;
  clusterRowByKey: Map<string, ProductAdvertisingWorkspaceClusterRow>;
  isClusterActionSubmitting: boolean;
  copiedClusterKey: string | null;
  onCopyClusterName: (clusterKey: string, clusterName: string) => void | Promise<void>;
  onReloadSheet: (options?: {
    advertId?: number | null;
    target?: "workspace" | "table" | "queries" | "detail" | "all";
    invalidateCaches?: boolean;
  }) => Promise<void>;
}) {
  const {
    nmId,
    requestInput,
    clusterRowByKey,
    isClusterActionSubmitting,
    onReloadSheet,
  } = input;
  const [editingBidClusterKey, setEditingBidClusterKey] = useState<string | null>(null);
  const [editingBidDraft, setEditingBidDraft] = useState("");
  const [savingBidClusterKey, setSavingBidClusterKey] = useState<string | null>(null);
  // Optimistic display value while the save request is in-flight.
  // Shown instead of row.bid so the user sees the new value immediately
  // without triggering a premature server fetch that could overwrite it.
  const [savingBidValue, setSavingBidValue] = useState<number | null>(null);
  const [bidErrorMessage, setBidErrorMessage] = useState<string | null>(null);

  const openClusterBidEditor = useCallback((row: ProductAdvertisingWorkspaceClusterRow) => {
    setBidErrorMessage(null);
    setEditingBidClusterKey(buildAdvertisingClusterGroupKey(row));
    setEditingBidDraft(row.bid === null ? "" : formatBidDraftValue(row.bid));
  }, []);

  const startEditingClusterBid = useCallback(
    (row: ProductAdvertisingWorkspaceClusterRow) => {
      if (!canEditAdvertisingClusterBid(row)) {
        return;
      }

      openClusterBidEditor(row);
    },
    [openClusterBidEditor],
  );

  const cancelEditingClusterBid = useCallback(() => {
    setEditingBidClusterKey(null);
    setEditingBidDraft("");
    setBidErrorMessage(null);
  }, []);

  const commitEditingClusterBid = useCallback(
    async (
      row: ProductAdvertisingWorkspaceClusterRow,
      options?: {
        draftValue?: string;
        preserveActiveEditor?: boolean;
      },
    ) => {
      if (
        nmId === null ||
        requestInput === null ||
        row.advertId === null ||
        !canEditAdvertisingClusterBid(row)
      ) {
        return;
      }

      const draftValue = options?.draftValue ?? editingBidDraft;
      const parsedBid = parseBidDraftValue(draftValue);
      if (parsedBid === null) {
        if (!options?.preserveActiveEditor) {
          setBidErrorMessage(ui.advertisingBidSaveError);
        }
        return;
      }

      const clusterKey = buildAdvertisingClusterGroupKey(row);
      const currentBid = normalizeDisplayedBid(row.bid);
      if (currentBid !== null && currentBid === parsedBid) {
        if (!options?.preserveActiveEditor) {
          cancelEditingClusterBid();
        }
        return;
      }

      setSavingBidClusterKey(clusterKey);
      setSavingBidValue(parsedBid);
      setBidErrorMessage(null);
      const snapshot = captureProductAdvertisingDetailCacheSnapshot({
        nmId,
        advertId: row.advertId,
        requestInput,
      });
      applyOptimisticClusterBidPatch({
        nmId,
        advertId: row.advertId,
        requestInput,
        row,
        bid: parsedBid,
      });
      if (!options?.preserveActiveEditor) {
        setEditingBidClusterKey(null);
        setEditingBidDraft("");
      }
      // NOTE: We intentionally do NOT call onReloadSheet before the API request
      // completes. Calling it here would bump the revision counter, which triggers
      // doFetch() in the cluster table hook. That fetch races against the save
      // request and can return stale server data (old bid) that overwrites the
      // optimistic update. Instead we show savingBidValue in the cell directly.
      try {
        const response = await applyProductAdvertisingClusterBid(
          nmId,
          row.advertId,
          row.clusterName,
          parsedBid,
        );
        applyClusterBidResponsePatch({
          nmId,
          requestInput,
          response,
        });
        // Keep the optimistically-patched cache intact — do NOT invalidate it here.
        // applyClusterBidResponsePatch already wrote the new bid + pending status into
        // all relevant cache entries. Passing invalidateCaches:false lets the table
        // reuse that cache immediately (no refreshing-overlay, no pointer-events:none).
        void onReloadSheet({
          advertId: row.advertId,
          target: "detail",
          invalidateCaches: false,
        });
        // После write-pass бэкенд инвалидирует кэш cluster-table.
        // target:"detail" перезапрашивает таблицу (и workspace), чтобы показать
        // новый bid_sync_status и галочку ✓ сразу после подтверждения на WB.
        window.setTimeout(() => void onReloadSheet({ target: "detail" }), 1_500);
        window.setTimeout(() => void onReloadSheet({ target: "detail" }), 4_000);
      } catch (requestError) {
        restoreProductAdvertisingDetailCacheSnapshot({
          nmId,
          requestInput,
          snapshot,
        });
        if (!options?.preserveActiveEditor) {
          setEditingBidClusterKey(clusterKey);
          setEditingBidDraft(draftValue);
        }
        void onReloadSheet({ advertId: row.advertId, target: "detail", invalidateCaches: false });
        setBidErrorMessage(getSafeMessage(requestError, ui.advertisingBidSaveError));
      } finally {
        setSavingBidClusterKey(null);
        setSavingBidValue(null);
      }
    },
    [cancelEditingClusterBid, editingBidDraft, nmId, onReloadSheet, requestInput],
  );

  const switchEditingClusterBid = useCallback(
    (nextRow: ProductAdvertisingWorkspaceClusterRow) => {
      const nextClusterKey = buildAdvertisingClusterGroupKey(nextRow);
      if (
        !canEditAdvertisingClusterBid(nextRow) ||
        editingBidClusterKey === null ||
        editingBidClusterKey === nextClusterKey
      ) {
        return;
      }

      const currentRow = clusterRowByKey.get(editingBidClusterKey);
      if (!currentRow) {
        openClusterBidEditor(nextRow);
        return;
      }

      const currentDraft = editingBidDraft;
      openClusterBidEditor(nextRow);
      void commitEditingClusterBid(currentRow, {
        draftValue: currentDraft,
        preserveActiveEditor: true,
      });
    },
    [
      commitEditingClusterBid,
      editingBidClusterKey,
      editingBidDraft,
      clusterRowByKey,
      openClusterBidEditor,
    ],
  );

  const renderReadOnlyBidCell = useCallback(
    (
      value: number | null,
      emptyLabel: string,
      options?: {
        status?: ProductAdvertisingSheetResponse["clusters"][number]["bidSyncStatus"];
        retryAt?: string | null;
        lastError?: string | null;
      },
    ) => {
      const formattedValue = formatNullableNumber(value);
      const hasValue = formattedValue !== "-";
      const statusPresentation = getBidSyncStatusPresentation(
        options?.status ?? null,
        options?.retryAt ?? null,
        options?.lastError ?? null,
      );

      return (
        <span className="wb-advertising-bid-cell">
          <span
            className={`wb-advertising-bid-badge ${hasValue ? "wb-advertising-bid-badge--readonly" : "wb-advertising-bid-badge--muted"}`}
            aria-label={hasValue ? formattedValue : emptyLabel}
            title={hasValue ? formattedValue : emptyLabel}
          >
            <span className="wb-advertising-bid-value">{formattedValue}</span>
          </span>
          {statusPresentation ? (
            <span
              className={`wb-advertising-bid-confirmed ${statusPresentation.className}`}
              aria-label={statusPresentation.label}
              title={statusPresentation.label}
            >
              {statusPresentation.symbol}
            </span>
          ) : null}
        </span>
      );
    },
    [],
  );

  const renderClusterBidCell = useCallback(
    (
      row: ProductAdvertisingWorkspaceClusterRow,
      options?: { nested?: boolean; emptyLabel?: string },
    ) => {
      const isNested = options?.nested ?? false;
      const clusterKey = buildAdvertisingClusterGroupKey(row);
      const clusterName = row.clusterName;
      const statusPresentation = getBidSyncStatusPresentation(
        row.bidSyncStatus,
        row.bidRetryAt,
        row.bidLastError,
      );

      if (editingBidClusterKey === clusterKey && !isNested) {
        return (
          <span className="wb-advertising-bid-cell">
            <input
              className="wb-advertising-bid-input"
              type="text"
              inputMode="decimal"
              value={editingBidDraft}
              disabled={savingBidClusterKey === clusterKey}
              onChange={(event) => {
                setEditingBidDraft(event.target.value);
                if (bidErrorMessage) {
                  setBidErrorMessage(null);
                }
              }}
              onBlur={() => {
                void commitEditingClusterBid(row);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitEditingClusterBid(row);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEditingClusterBid();
                }
              }}
              aria-label={`Ставка для кластера ${clusterName}`}
              autoFocus
            />
            <span
              className="wb-advertising-bid-confirmed wb-advertising-bid-confirmed--placeholder"
              aria-hidden="true"
            >
              ✓
            </span>
          </span>
        );
      }

      if (canEditAdvertisingClusterBid(row)) {
        // While the save is in-flight, show the new bid value the user just typed
        // rather than the stale row.bid from the last server response.
        const isSaving = savingBidClusterKey === clusterKey;
        const displayBid = isSaving && savingBidValue !== null ? savingBidValue : row.bid;
        return (
          <span className="wb-advertising-bid-cell">
            <button
              type="button"
              className={`wb-advertising-bid-button wb-advertising-bid-button--editable${
                isNested ? " wb-advertising-bid-button--nested" : ""
              }`}
              disabled={isSaving || isClusterActionSubmitting}
              onMouseDown={(event) => {
                if (editingBidClusterKey !== null && editingBidClusterKey !== clusterKey) {
                  event.preventDefault();
                  switchEditingClusterBid(row);
                }
              }}
              onClick={() => startEditingClusterBid(row)}
              title={
                isNested
                  ? `Изменить ставку кластера ${clusterName}`
                  : `Изменить ставку для кластера ${clusterName}`
              }
            >
              <span className="wb-advertising-bid-button__value">
                {formatNullableNumber(displayBid)}
              </span>
            </button>
            {savingBidClusterKey !== clusterKey && statusPresentation ? (
              <span
                className={`wb-advertising-bid-confirmed ${statusPresentation.className}`}
                aria-label={statusPresentation.label}
                title={statusPresentation.label}
              >
                {statusPresentation.symbol}
              </span>
            ) : (
              <span
                className="wb-advertising-bid-confirmed wb-advertising-bid-confirmed--placeholder"
                aria-hidden="true"
              >
                ✓
              </span>
            )}
          </span>
        );
      }

      return renderReadOnlyBidCell(
        row.bid,
        options?.emptyLabel ??
          `Ставка для кластера ${clusterName} недоступна для редактирования`,
        {
          status: row.bidSyncStatus,
          retryAt: row.bidRetryAt,
          lastError: row.bidLastError,
        },
      );
    },
    [
      bidErrorMessage,
      cancelEditingClusterBid,
      commitEditingClusterBid,
      editingBidClusterKey,
      editingBidDraft,
      isClusterActionSubmitting,
      renderReadOnlyBidCell,
      savingBidClusterKey,
      savingBidValue,
      startEditingClusterBid,
      switchEditingClusterBid,
    ],
  );

  return {
    bidErrorMessage,
    renderClusterBidCell,
  };
}
