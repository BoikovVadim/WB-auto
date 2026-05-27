import { useEffect, useMemo, useRef, useState } from "react";

import { getCachedProductWorkspace } from "../../../api/productWorkspaceClient";
import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import { fetchProductAdvertisingWorkspace } from "../../../api/syncClient";
import {
  advertisingUxBudgetsMs,
  completeAdvertisingUxBudget,
  startAdvertisingUxBudget,
} from "./advertisingUxBudgets";
import { buildPendingProductAdvertisingWorkspace } from "./productAdvertisingWorkspacePendingState";
import { ui } from "../copy";
import { normalizeDashboardReadError } from "../dashboardErrors";

export function useProductAdvertisingWorkspace(input: {
  active: boolean;
  nmId: number | null;
  requestInput: ProductAdvertisingSheetRequestInput | null;
  refreshKey?: number;
}) {
  // Строковый ключ, стабильно идентифицирующий запрос по значениям, а не ссылке.
  // Это исключает ложные перезапуски эффектов при каждом ре-рендере, когда
  // resolveProductAdvertisingSheetRequestInput создаёт новый объект с теми же данными.
  const requestKey = useMemo(
    () =>
      input.active && input.nmId !== null && input.requestInput
        ? `${String(input.nmId)}:${input.requestInput.startDate}:${input.requestInput.endDate}`
        : null,
    [input.active, input.nmId, input.requestInput],
  );

  const cachedWorkspace = useMemo(() => {
    if (!input.active || input.nmId === null || !input.requestInput) {
      return null;
    }

    return getCachedProductWorkspace(input.nmId, input.requestInput);
  // requestKey достаточно как dep — кодирует nmId + startDate + endDate.
  // Объект input.requestInput оставлен для корректного вызова getCachedProductWorkspace,
  // но реально эффект перезапускается только при смене requestKey (строки).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // Ref для доступа к актуальному requestInput внутри эффектов без включения
  // объекта в deps.
  const requestInputRef = useRef(input.requestInput);
  useEffect(() => {
    requestInputRef.current = input.requestInput;
  });

  const bootstrapWorkspace = cachedWorkspace;
  const [productAdvertisingWorkspace, setProductAdvertisingWorkspace] = useState(bootstrapWorkspace);
  const [productAdvertisingWorkspaceError, setProductAdvertisingWorkspaceError] = useState<string | null>(null);
  // Инициализируем loading корректно с первого рендера: если кэша нет, сразу
  // показываем состояние загрузки вместо однокадрового флеша «Загружаем…» из gate.
  const [isProductAdvertisingWorkspaceLoading, setIsProductAdvertisingWorkspaceLoading] = useState(
    () => input.active && input.nmId !== null && bootstrapWorkspace === null,
  );
  const lastRefreshKeyRef = useRef(input.refreshKey ?? 0);

  useEffect(() => {
    setProductAdvertisingWorkspace((currentValue) => {
      if (bootstrapWorkspace) {
        return bootstrapWorkspace;
      }

      // При смене дат (пресет) — оставляем stale-воркспейс того же товара видимым
      // пока грузятся новые данные. Но range-scoped summary/counts и bootstrap-таблицу
      // убираем: иначе на новом диапазоне можно увидеть старые счётчики РК и пустую таблицу.
      // При смене товара (nmId) — очищаем: чужой воркспейс показывать нельзя.
      if (currentValue?.nmId === input.nmId) {
        return buildPendingProductAdvertisingWorkspace(currentValue);
      }

      return null;
    });
    setProductAdvertisingWorkspaceError(null);
  // requestKey (строка) вместо input.requestInput (объект) — стабильный dep.
  }, [bootstrapWorkspace, input.nmId, requestKey]);

  useEffect(() => {
    if (!input.active || input.nmId === null || !requestInputRef.current) {
      return;
    }

    const currentRequestInput = requestInputRef.current;
    const refreshKey = input.refreshKey ?? 0;
    const shouldForceRefresh = refreshKey !== lastRefreshKeyRef.current;
    lastRefreshKeyRef.current = refreshKey;
    const budgetKey = buildWorkspaceBudgetKey(
      input.nmId,
      currentRequestInput.startDate,
      currentRequestInput.endDate,
    );
    startAdvertisingUxBudget(
      budgetKey,
      "product workspace shell visible",
      advertisingUxBudgetsMs.dateChangeShellVisible,
    );
    if (bootstrapWorkspace) {
      completeAdvertisingUxBudget(budgetKey);
    }
    const canReuseCachedWorkspace =
      cachedWorkspace &&
      !shouldForceRefresh &&
      !shouldBackgroundRefreshWorkspace(cachedWorkspace);
    if (canReuseCachedWorkspace) {
      setIsProductAdvertisingWorkspaceLoading(false);
      return;
    }

    let isCancelled = false;
    let retryTimerId: ReturnType<typeof setTimeout> | null = null;
    setIsProductAdvertisingWorkspaceLoading(bootstrapWorkspace === null);

    const attemptFetch = () => {
      const nmId = input.nmId;
      if (isCancelled || nmId === null) return;
      void fetchProductAdvertisingWorkspace(nmId, currentRequestInput)
        .then((response) => {
          if (isCancelled) {
            return;
          }

          setProductAdvertisingWorkspace(response);
          setProductAdvertisingWorkspaceError(null);
          setIsProductAdvertisingWorkspaceLoading(false);
          completeAdvertisingUxBudget(budgetKey);
        })
        .catch((error) => {
          if (isCancelled) {
            return;
          }

          const message = normalizeDashboardReadError(error, ui.productAdvertisingWorkspaceLoadError);
          setProductAdvertisingWorkspaceError(message);

          if (message === null) {
            // Тихая ошибка (503/502/504/network): автоматически повторить через 5с,
            // сохраняя isLoading=true чтобы не показывать пустую страницу.
            retryTimerId = setTimeout(attemptFetch, 5_000);
          } else {
            setIsProductAdvertisingWorkspaceLoading(false);
          }
        });
    };

    attemptFetch();

    return () => {
      isCancelled = true;
      if (retryTimerId !== null) {
        clearTimeout(retryTimerId);
      }
    };
  // requestKey (строка) вместо input.requestInput (объект). bootstrapWorkspace и
  // cachedWorkspace — объекты, но они обновляются только при смене requestKey,
  // поэтому не создают лишних перезапусков.
  }, [
    input.active,
    input.nmId,
    requestKey,
    input.refreshKey,
    bootstrapWorkspace,
    cachedWorkspace,
  ]);
  const displayWorkspace = productAdvertisingWorkspace ?? bootstrapWorkspace;
  const displayWorkspaceLoading =
    isProductAdvertisingWorkspaceLoading && displayWorkspace === null;
  return {
    productAdvertisingWorkspace: displayWorkspace,
    productAdvertisingWorkspaceError,
    isProductAdvertisingWorkspaceLoading: displayWorkspaceLoading,
  };
}

function buildWorkspaceBudgetKey(nmId: number, startDate: string, endDate: string) {
  return `workspace:${String(nmId)}:${startDate}:${endDate}`;
}

function shouldBackgroundRefreshWorkspace(value: {
  checkedAt: string;
  snapshot: { status: string };
  syncState: { refreshStatus: "idle" | "running" };
}) {
  if (value.syncState.refreshStatus === "running" || value.snapshot.status !== "ready") {
    return true;
  }

  const checkedAtMs = Date.parse(value.checkedAt);
  if (!Number.isFinite(checkedAtMs)) {
    return true;
  }

  return Date.now() - checkedAtMs > 60_000;
}
