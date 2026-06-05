import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Modal } from "../../../components/Modal";
import { formatMoney } from "../../../formatters";
import type {
  ClusterAutomationState,
  ClusterFilterRow,
} from "../../../api/syncClientClusterAutomation";
import { useClusterAutomationFilters } from "./useClusterAutomationFilters";
import {
  clearClusterFilterDraft,
  readClusterFilterDraft,
  writeClusterFilterDraft,
  type ClusterFilterRole as Role,
} from "./clusterFilterDraftStorage";
import { retryWithBackoff } from "../../../api/retryWithBackoff";
import { isTransientHttpError } from "../../../api/syncClientHttp";

type Props = {
  nmId: number;
  advertId: number;
  onClose: () => void;
};

const ROW_HEIGHT = 38;

function stateLabel(state: ClusterAutomationState | null): string {
  switch (state) {
    case "protected":
      return "белый список";
    case "blacklisted":
      return "чёрный список";
    case "active":
    case "manual_protected":
      return "активен";
    case "excluded_high":
      return "искл. по CPO";
    default:
      return "";
  }
}

function initialRole(row: ClusterFilterRow): Role {
  if (row.isBlacklisted) return "blacklisted";
  if (row.isProtected) return "protected";
  return "auto";
}

export function ProductAdvertisingFilterSettingsModal({ nmId, advertId, onClose }: Props) {
  const { config, isLoading, isSaving, error, saveFilters } = useClusterAutomationFilters(
    nmId,
    advertId,
  );
  const [search, setSearch] = useState("");
  // Локальные изменения ролей поверх пришедшего конфига (key → role). Черновик
  // несохранённого выбора персистится в localStorage, поэтому переживает F5/переоткрытие
  // и подставляется обратно при монтировании (по паре nmId+advertId).
  const [overrides, setOverrides] = useState<Map<string, Role>>(
    () => new Map(Object.entries(readClusterFilterDraft(nmId, advertId))),
  );
  const listRef = useRef<HTMLDivElement>(null);

  const roleOf = (row: ClusterFilterRow): Role =>
    overrides.get(row.normalizedClusterName) ?? initialRole(row);

  const setRole = (row: ClusterFilterRow, role: Role) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      // Возврат к исходной (серверной) роли — не отличие, убираем из черновика.
      if (role === initialRole(row)) {
        next.delete(row.normalizedClusterName);
      } else {
        next.set(row.normalizedClusterName, role);
      }
      writeClusterFilterDraft(nmId, advertId, Object.fromEntries(next));
      return next;
    });
  };

  const counts = useMemo(() => {
    let white = 0;
    let black = 0;
    for (const row of config.clusters) {
      const role = overrides.get(row.normalizedClusterName) ?? initialRole(row);
      if (role === "protected") white += 1;
      else if (role === "blacklisted") black += 1;
    }
    return { white, black };
  }, [config.clusters, overrides]);

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

  const handleSave = () => {
    const protectedRows: ClusterFilterRow[] = [];
    const blacklistedRows: ClusterFilterRow[] = [];
    for (const row of config.clusters) {
      const role = overrides.get(row.normalizedClusterName) ?? initialRole(row);
      if (role === "protected") protectedRows.push(row);
      else if (role === "blacklisted") blacklistedRows.push(row);
    }
    // Ретраим на транзиентных ошибках (502 в окне рестарта бэка после деплоя), чтобы
    // сохранение пережило деплой. Черновик чистим ТОЛЬКО при успехе — при ошибке выбор
    // остаётся и переживает перезагрузку.
    void retryWithBackoff(
      () => saveFilters({ protected: protectedRows, blacklisted: blacklistedRows }),
      { shouldRetry: isTransientHttpError },
    )
      .then(() => {
        clearClusterFilterDraft(nmId, advertId);
        onClose();
      })
      .catch(() => {
        /* ошибка показана в error */
      });
  };

  return (
    <Modal
      title="Настройка фильтров"
      onClose={onClose}
      width={680}
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
        Списки кластеров
        {counts.white > 0 ? ` · белый ${String(counts.white)}` : ""}
        {counts.black > 0 ? ` · чёрный ${String(counts.black)}` : ""}
      </p>
      <p className="wb-filter-settings__hint">
        <strong>Белый</strong> — кластер нельзя выключать (автоматика всегда держит активным,
        даже при высоком CPO). <strong>Чёрный</strong> — кластер нельзя включать (всегда
        выключен). Чёрный приоритетнее белого. <strong>Авто</strong> — решает автоматика по CPO.
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
              const role = roleOf(row);
              const label = stateLabel(row.state);
              return (
                <div
                  key={row.normalizedClusterName}
                  className="wb-filter-settings__row"
                  style={{ height: ROW_HEIGHT }}
                >
                  <span className="wb-filter-settings__row-name" title={row.clusterName}>
                    {row.clusterName}
                    {label ? (
                      <span style={{ color: "var(--wb-text-muted)" }}> · {label}</span>
                    ) : null}
                  </span>
                  <span className="wb-filter-settings__row-cpo">
                    {row.lastCpo !== null ? (
                      formatMoney(row.lastCpo)
                    ) : row.lastSpend !== null && row.lastSpend > 0 ? (
                      // Заказов нет → CPO не определён (делить не на что). Показываем весь
                      // расход с пометкой, чтобы было видно, сколько слито на кластер.
                      <span title="Весь расход кластера — заказов нет, CPO не определён">
                        {formatMoney(row.lastSpend)}
                        <span style={{ color: "var(--wb-text-muted)", fontSize: "0.85em" }}> расх.</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </span>
                  <span className="wb-filter-role" role="group" aria-label="Роль кластера">
                    <button
                      type="button"
                      className={`wb-filter-role__btn${role === "auto" ? " is-active" : ""}`}
                      onClick={() => setRole(row, "auto")}
                    >
                      Авто
                    </button>
                    <button
                      type="button"
                      className={`wb-filter-role__btn wb-filter-role__btn--white${role === "protected" ? " is-active" : ""}`}
                      onClick={() => setRole(row, "protected")}
                    >
                      Белый
                    </button>
                    <button
                      type="button"
                      className={`wb-filter-role__btn wb-filter-role__btn--black${role === "blacklisted" ? " is-active" : ""}`}
                      onClick={() => setRole(row, "blacklisted")}
                    >
                      Чёрный
                    </button>
                  </span>
                </div>
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
