import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProductAdvertisingWorkspaceResponse } from "../../../api/syncClient";
import type { AdvertisingDateBounds } from "./date";
import { parseAdvertisingDayValue } from "./date";

function readStoredCampaignId(nmId: number): number | null {
  try {
    const raw = window.sessionStorage.getItem(`wb-adv-campaign-${String(nmId)}`);
    if (raw === null) return null;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
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
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(() =>
    nmId !== null ? readStoredCampaignId(nmId) : null,
  );
  const prevNmIdRef = useRef(nmId);

  // Сбрасываем выбранную РК при смене товара (изменении nmId).
  // Это гарантирует, что при входе в товар useEffect ниже выберет верхнюю РК.
  useEffect(() => {
    if (prevNmIdRef.current === nmId) {
      return;
    }
    prevNmIdRef.current = nmId;
    setSelectedCampaignId(null);
  }, [nmId]);

  const campaignSummaries = useMemo(() => workspace?.campaignTabs ?? [], [workspace?.campaignTabs]);
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
      return;
    }

    setSelectedCampaignId((currentValue) => {
      // Уже выбрана валидная РК (пользователь переключил вручную или она восстановлена) — не трогаем.
      if (
        currentValue !== null &&
        campaignSummaries.some((item) => item.advertId === currentValue)
      ) {
        return currentValue;
      }

      // Иначе берём первую РК из backend-ordered списка
      return campaignSummaries[0]?.advertId ?? null;
    });
  }, [campaignSummaries]);

  const setSelectedCampaignIdPersisted = useCallback(
    (advertId: number) => {
      setSelectedCampaignId(advertId);
      if (nmId !== null) {
        writeStoredCampaignId(nmId, advertId);
      }
    },
    [nmId],
  );

  return {
    campaignSummaries,
    clusterDailyStatsBounds,
    selectedCampaign,
    selectedCampaignId,
    setSelectedCampaignId: setSelectedCampaignIdPersisted,
  };
}
