import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProductAdvertisingWorkspaceResponse } from "../../../api/syncClient";
import type { AdvertisingDateBounds } from "./date";
import { parseAdvertisingDayValue } from "./date";

function getCampaignStatusPriority(status: number | null | undefined): number {
  if (status === 9) return 0;  // active / running
  if (status === 11) return 1; // paused
  return 2;                    // disabled / excluded
}

function readStoredCampaignId(nmId: number): number | null {
  try {
    const raw = window.sessionStorage.getItem(`wb-adv-campaign-${String(nmId)}`);
    if (raw === null) return null;
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

function writeStoredCampaignId(nmId: number, advertId: number) {
  try {
    window.sessionStorage.setItem(`wb-adv-campaign-${String(nmId)}`, String(advertId));
  } catch {
    // ignore quota errors
  }
}

export function useAdvertisingCampaignSelection(
  nmId: number | null,
  workspace: ProductAdvertisingWorkspaceResponse | null,
) {
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  // Фиксируем nmId на момент маунта компонента:
  // – если nmId не изменился с маунта → это обновление страницы → восстанавливаем из sessionStorage
  // – если nmId изменился (навигация из списка товаров) → сбрасываем на первую РК
  const mountNmIdRef = useRef(nmId);

  // Sort by status priority (active → paused → disabled) so campaignSummaries[0]
  // always matches the visually top card in ProductAdvertisingClusterOverview.
  const campaignSummaries = useMemo(
    () =>
      [...(workspace?.campaignTabs ?? [])].sort(
        (a, b) =>
          getCampaignStatusPriority(a.campaignStatus) -
          getCampaignStatusPriority(b.campaignStatus),
      ),
    [workspace],
  );
  const clusterDailyStatsBounds = useMemo<AdvertisingDateBounds>(() => {
    const workspaceMinDate = workspace?.dateBounds.minDate
      ? parseAdvertisingDayValue(workspace.dateBounds.minDate)
      : null;
    const workspaceMaxDate = workspace?.dateBounds.maxDate
      ? parseAdvertisingDayValue(workspace.dateBounds.maxDate)
      : null;

    if (workspaceMinDate && workspaceMaxDate) {
      return {
        min: workspaceMinDate,
        max: workspaceMaxDate,
      };
    }

    return null;
  }, [workspace]);
  const selectedCampaign = useMemo(
    () =>
      campaignSummaries.find((item) => item.advertId === selectedCampaignId) ??
      campaignSummaries[0] ??
      null,
    [campaignSummaries, selectedCampaignId],
  );

  useEffect(() => {
    if (campaignSummaries.length === 0) {
      setSelectedCampaignId(null);
      return;
    }

    setSelectedCampaignId((currentValue) => {
      // Уже выбрана валидная РК (пользователь переключил вручную или восстановлена) — не трогаем.
      if (
        currentValue !== null &&
        campaignSummaries.some((item) => item.advertId === currentValue)
      ) {
        return currentValue;
      }

      // Определяем: nmId не изменился с маунта → обновление страницы → пробуем восстановить.
      // Если nmId изменился → вход из списка товаров → берём первую РК.
      const isRefresh = nmId !== null && nmId === mountNmIdRef.current;
      if (isRefresh) {
        const storedId = readStoredCampaignId(nmId);
        if (storedId !== null && campaignSummaries.some((item) => item.advertId === storedId)) {
          return storedId;
        }
      }

      return campaignSummaries[0]?.advertId ?? null;
    });
  // nmId намеренно не в deps: нас интересует изменение campaignSummaries,
  // а nmId читается из замыкания в момент срабатывания эффекта.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignSummaries]);

  // Обёртка над setSelectedCampaignId: сохраняет выбор пользователя в sessionStorage.
  const setSelectedCampaignIdPersisted = useCallback((advertId: number) => {
    setSelectedCampaignId(advertId);
    if (nmId !== null) {
      writeStoredCampaignId(nmId, advertId);
    }
  }, [nmId]);

  return {
    campaignSummaries,
    clusterDailyStatsBounds,
    selectedCampaign,
    selectedCampaignId,
    setSelectedCampaignId: setSelectedCampaignIdPersisted,
  };
}
