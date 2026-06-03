import { useEffect, useState } from "react";

import {
  fetchProductAutomationStatuses,
  type ProductAutomationStatusEntry,
} from "../../../api/syncClientClusterAutomation";

// Лёгкий memory-кэш сводных статусов автоматизации по товарам — чтобы при возврате в
// раздел таблица рисовала колонку сразу, без повторного запроса. Ключ один (глобальный
// список), поэтому простой синглтон. Инвалидация — после смены режима автоматизации.
let cachedByNmId: Record<number, ProductAutomationStatusEntry> | null = null;
const subscribers = new Set<(value: Record<number, ProductAutomationStatusEntry>) => void>();

export function invalidateProductAutomationStatuses(): void {
  cachedByNmId = null;
}

async function refresh(): Promise<void> {
  try {
    const { byNmId } = await fetchProductAutomationStatuses();
    cachedByNmId = byNmId;
    for (const notify of subscribers) notify(byNmId);
  } catch {
    // сеть/ошибка — оставляем что было, колонка просто покажет «—»
  }
}

/**
 * Сводный статус автоматизации по товарам (nmId → режим) для колонки в таблице.
 * Возвращает карту; пустую — пока грузится. `active=false` отключает загрузку.
 */
export function useProductAutomationStatuses(
  active: boolean,
): Record<number, ProductAutomationStatusEntry> {
  const [byNmId, setByNmId] = useState<Record<number, ProductAutomationStatusEntry>>(
    () => cachedByNmId ?? {},
  );

  useEffect(() => {
    if (!active) return;
    subscribers.add(setByNmId);
    if (cachedByNmId) {
      setByNmId(cachedByNmId);
    } else {
      void refresh();
    }
    return () => {
      subscribers.delete(setByNmId);
    };
  }, [active]);

  return byNmId;
}
