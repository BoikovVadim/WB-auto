import { useEffect, useRef } from "react";

import { getCachedProductWorkspace } from "../../../api/productWorkspaceClient";
import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import { fetchProductAdvertisingWorkspace } from "../../../api/syncClient";

// Все видимые в viewport продукты грузим сразу — нет смысла ограничивать,
// т.к. visibleNmIds уже ограничен видимой областью списка.
const visibleWorkspacePrefetchLimit = 100;
// Параллельно по 8 запросов вместо 4 — ускоряет заполнение кеша.
const workspacePrefetchChunkSize = 8;
const backgroundWorkspacePrefetchDelayMs = 600;
// Workspace считается устаревшим через 60 секунд — то же значение, что и в
// shouldBackgroundRefreshWorkspace. Prefetch обновляет устаревший workspace
// заранее, пока пользователь читает список, чтобы клик на любой товар был
// мгновенным даже после возврата с экрана детали.
const workspaceStaleTtlMs = 60_000;

function isWorkspaceStale(workspace: { checkedAt: string }): boolean {
  const checkedAtMs = Date.parse(workspace.checkedAt);
  return !Number.isFinite(checkedAtMs) || Date.now() - checkedAtMs > workspaceStaleTtlMs;
}

export function useProductAdvertisingWorkspacePrefetch(input: {
  active: boolean;
  requestInput: ProductAdvertisingSheetRequestInput | null;
  visibleNmIds: number[];
  allNmIds: number[];
}) {
  const requestedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!input.active || !input.requestInput) {
      return;
    }

    const requestInput = input.requestInput;
    let isCancelled = false;

    const prefetchNmIds = async (nmIds: number[]) => {
      for (let index = 0; index < nmIds.length; index += workspacePrefetchChunkSize) {
        if (isCancelled) {
          return;
        }

        const chunk = nmIds.slice(index, index + workspacePrefetchChunkSize);
        await Promise.all(
          chunk.map(async (nmId) => {
            if (nmId <= 0) {
              return;
            }

            const cached = getCachedProductWorkspace(nmId, requestInput);
            // Пропускаем: workspace свежий (< 60 с).
            if (cached && !isWorkspaceStale(cached)) {
              return;
            }

            const requestKey = buildWorkspacePrefetchKey(nmId, requestInput);
            if (requestedKeysRef.current.has(requestKey)) {
              return;
            }

            requestedKeysRef.current.add(requestKey);
            try {
              await fetchProductAdvertisingWorkspace(nmId, requestInput);
            } catch {
              requestedKeysRef.current.delete(requestKey);
            }
          }),
        );
      }
    };

    // При смене requestInput (новые даты) сбрасываем список уже запрошенных ключей,
    // чтобы переобновить workspace для всех продуктов с новым периодом.
    requestedKeysRef.current = new Set();

    const visibleNmIds = input.visibleNmIds.slice(0, visibleWorkspacePrefetchLimit);
    void prefetchNmIds(visibleNmIds);

    const timeoutId = window.setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      void prefetchNmIds(input.allNmIds);
    }, backgroundWorkspacePrefetchDelayMs);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [input.active, input.allNmIds, input.requestInput, input.visibleNmIds]);
}

function buildWorkspacePrefetchKey(nmId: number, requestInput: ProductAdvertisingSheetRequestInput) {
  return [
    "workspace-prefetch",
    String(nmId),
    requestInput.startDate,
    requestInput.endDate,
  ].join(":");
}
