import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Modal } from "../../../components/Modal";
import { formatMoney } from "../../../formatters";
import type {
  ClusterAutomationState,
  ClusterFilterRow,
} from "../../../api/syncClientClusterAutomation";
import { useClusterAutomationFilters } from "./useClusterAutomationFilters";

type Props = {
  nmId: number;
  advertId: number;
  onClose: () => void;
};

const ROW_HEIGHT = 34;

function stateLabel(state: ClusterAutomationState | null): string {
  switch (state) {
    case "protected":
      return "защищён";
    case "active":
    case "manual_protected":
      return "активен";
    case "excluded_high":
      return "искл. по CPO";
    default:
      return "";
  }
}

export function ProductAdvertisingFilterSettingsModal({ nmId, advertId, onClose }: Props) {
  const { config, isLoading, isSaving, error, saveProtected } = useClusterAutomationFilters(
    nmId,
    advertId,
  );
  const [search, setSearch] = useState("");
  // Локальный набор выбранных (защищённых) — инициализируется из конфига при загрузке.
  const [protectedKeys, setProtectedKeys] = useState<Set<string> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Синхронизация локального выбора с пришедшим конфигом (один раз, пока пользователь не трогал).
  const initialKeys = useMemo(
    () => new Set(config.clusters.filter((c) => c.isProtected).map((c) => c.normalizedClusterName)),
    [config.clusters],
  );
  const effectiveKeys = protectedKeys ?? initialKeys;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return config.clusters;
    return config.clusters.filter((c) => c.clusterName.toLowerCase().includes(q));
  }, [config.clusters, search]);

  const rowVirt = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const virtualItems = rowVirt.getVirtualItems();
  const totalSize = rowVirt.getTotalSize();
  const topSpacer = virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const bottomSpacer =
    virtualItems.length > 0 ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0) : 0;

  const toggle = (row: ClusterFilterRow) => {
    setProtectedKeys((prev) => {
      const next = new Set(prev ?? initialKeys);
      if (next.has(row.normalizedClusterName)) next.delete(row.normalizedClusterName);
      else next.add(row.normalizedClusterName);
      return next;
    });
  };

  const handleSave = () => {
    const rows = config.clusters.filter((c) => effectiveKeys.has(c.normalizedClusterName));
    void saveProtected(rows)
      .then(() => onClose())
      .catch(() => {
        /* ошибка показана в error */
      });
  };

  const protectedCount = effectiveKeys.size;

  return (
    <Modal
      title="Настройка фильтров"
      onClose={onClose}
      width={640}
      footer={
        <>
          {error ? (
            <span style={{ marginRight: "auto", fontSize: "11px", color: "#c0392b" }}>{error}</span>
          ) : null}
          <button
            type="button"
            className="wb-toggle-pill wb-toggle-pill--compact"
            onClick={onClose}
            disabled={isSaving}
          >
            Отмена
          </button>
          <button
            type="button"
            className="wb-toggle-pill wb-toggle-pill--compact active"
            onClick={handleSave}
            disabled={isSaving || isLoading}
          >
            {isSaving ? "Сохранение..." : "Сохранить"}
          </button>
        </>
      }
    >
      <p className="wb-filter-settings__section-title">
        Защищённые кластеры{protectedCount > 0 ? ` · ${String(protectedCount)}` : ""}
      </p>
      <p className="wb-filter-settings__hint">
        Эти кластеры автоматика никогда не отключает — всегда держит активными, даже при высоком
        CPO. Если кластер сейчас исключён на WB, в боевом режиме он будет включён.
      </p>

      <input
        type="text"
        className="wb-filter-settings__search"
        placeholder="Поиск кластера…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div ref={listRef} className="wb-filter-settings__list">
        {isLoading ? (
          <div className="wb-filter-settings__empty">Загрузка…</div>
        ) : filtered.length === 0 ? (
          <div className="wb-filter-settings__empty">
            {config.clusters.length === 0 ? "Нет кластеров" : "Ничего не найдено"}
          </div>
        ) : (
          <>
            <div style={{ height: topSpacer }} />
            {virtualItems.map((vi) => {
              const row = filtered[vi.index];
              if (!row) return null;
              const checked = effectiveKeys.has(row.normalizedClusterName);
              const label = stateLabel(row.state);
              return (
                <label
                  key={row.normalizedClusterName}
                  className="wb-filter-settings__row"
                  style={{ height: ROW_HEIGHT }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggle(row)} />
                  <span className="wb-filter-settings__row-name" title={row.clusterName}>
                    {row.clusterName}
                    {label ? (
                      <span style={{ color: "var(--wb-text-muted)" }}> · {label}</span>
                    ) : null}
                  </span>
                  <span className="wb-filter-settings__row-cpo">
                    {row.lastCpo !== null ? formatMoney(row.lastCpo) : "—"}
                  </span>
                </label>
              );
            })}
            <div style={{ height: bottomSpacer }} />
          </>
        )}
      </div>

      <div className="wb-filter-settings__soon">
        <strong>Кластеры в работе</strong> — адаптивный режим под целевой ДРР (система сама
        добавляет/убирает кластеры) появится следующим этапом.
      </div>
    </Modal>
  );
}
