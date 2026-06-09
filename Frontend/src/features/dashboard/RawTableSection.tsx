import React, { memo, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { cacheRawSection, getCachedRawSection } from "../../api/rawSectionCache";

import { mutedStyle, tdStyle, thStyle } from "./RawTableSection.styles";

export type ColumnDef<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  width?: number | string;
  /** Return a comparable primitive for client-side sorting. Omit to disable sort for this column. */
  sortValue?: (row: T) => string | number | null | undefined;
};

type SortDir = "asc" | "desc";

// Фикс. высота строки → виртуализатору не нужен measureElement (точная математика
// спейсеров без дрейфа). Ячейки single-line (nowrap + ellipsis), поэтому высота
// детерминирована: padding 7+7 + border 1 + строка ≈ 34px.
const ROW_H = 34;
// Дефолтная «ширина-пропорция» колонки для table-layout:fixed. С width:100% это
// работает как доля: числовые узкие, текстовые (имя/кластер) — шире (см. consumers).
const DEFAULT_COL_WIDTH = 100;

type RawTableSectionProps<T> = {
  title: string;
  subtitle?: string;
  onBack: () => void;
  fetchData: () => Promise<T[]>;
  /** Pre-loaded rows — if provided the table renders immediately without a loading state. */
  initialData?: T[] | null;
  columns: ColumnDef<T>[];
  getRowKey: (row: T) => string;
  filterRow?: (row: T, search: string) => boolean;
  extraControls?: React.ReactNode;
  refetchKey?: number;
  /**
   * Если задан — раздел кэширует строки (memory+sessionStorage) под этим ключом и при
   * повторном заходе/F5 рисует первый кадр из кэша мгновенно, ревалидируя в фоне (без скелетона).
   */
  cacheKey?: string;
  /** Optional slot rendered above the table (after header), receives loaded rows. */
  headerSlot?: (rows: T[]) => React.ReactNode;
  /** Column key to sort by on first render. */
  defaultSortKey?: string;
  /** Sort direction applied with defaultSortKey. Defaults to "desc". */
  defaultSortDir?: SortDir;
};

// ── Мемо-строка тела ────────────────────────────────────────────────────────
// При скролле виртуализатор перерисовывает родителя, но `row`/`columns` стабильны
// (массив строк меняется только на смену данных/сортировки/поиска, а не на скролл)
// → строки в окне «бейлятся» из reconcile. Только реально входящие рендерятся.
type RawRowProps<T> = { row: T; columns: ColumnDef<T>[] };

function RawTableRowInner<T>({ row, columns }: RawRowProps<T>) {
  return (
    <tr style={{ height: ROW_H }}>
      {columns.map((col) => (
        <td key={col.key} style={tdStyle}>
          {col.render(row)}
        </td>
      ))}
    </tr>
  );
}

// memo с дефолтным shallow-compare (row/columns — стабильные ссылки при скролле).
const RawTableRow = memo(RawTableRowInner) as <T>(p: RawRowProps<T>) => ReactElement;

export function RawTableSection<T>({
  title,
  subtitle,
  onBack,
  fetchData,
  initialData,
  columns,
  getRowKey,
  filterRow,
  extraControls,
  refetchKey = 0,
  cacheKey,
  headerSlot,
  defaultSortKey,
  defaultSortDir = "desc",
}: RawTableSectionProps<T>) {
  // Первый кадр: initialData → кэш по cacheKey → пусто. При наличии данных скелетон не нужен.
  const cachedRows = cacheKey ? getCachedRawSection<T>(cacheKey) : null;
  const [rows, setRows] = useState<T[]>(() => initialData ?? cachedRows ?? []);
  const [isLoading, setIsLoading] = useState(() => initialData == null && cachedRows == null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialData != null && refetchKey === 0) {
      return;
    }
    // Есть кэш/данные на руках — ревалидируем в фоне, без переключения на скелетон.
    const hasRows = (cacheKey ? getCachedRawSection<T>(cacheKey) : null) != null;
    if (!hasRows) {
      setIsLoading(true);
    }
    setError(null);
    fetchData()
      .then((data) => {
        setRows(data);
        if (cacheKey) {
          cacheRawSection(cacheKey, data);
        }
      })
      .catch((err: unknown) => {
        // С кэшем на руках ошибку фона не показываем — оставляем кэш.
        if (!hasRows) {
          setError(err instanceof Error ? err.message : "Ошибка загрузки");
        }
      })
      .finally(() => setIsLoading(false));
  }, [fetchData, refetchKey, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let result = filterRow && search
      ? rows.filter((row) => filterRow(row, search.toLowerCase()))
      : rows;

    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col?.sortValue) {
        const sv = col.sortValue;
        result = [...result].sort((a, b) => {
          const av = sv(a) ?? "";
          const bv = sv(b) ?? "";
          if (av === bv) return 0;
          const cmp = typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv), "ru");
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return result;
  }, [rows, filterRow, search, sortKey, sortDir, columns]);

  // Виртуализация строк — в DOM только видимое окно (~30 строк) независимо от
  // объёма (1000-5000+). Спейсеры сверху/снизу держат высоту скролла.
  const rowVirt = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });
  const virtualItems = rowVirt.getVirtualItems();
  const totalSize = rowVirt.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0)
      : 0;

  // Смена поиска/сортировки → к началу списка (как раньше пагинация сбрасывала на стр. 1).
  useEffect(() => {
    rowVirt.scrollToOffset(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [search, sortKey, sortDir, rowVirt]);

  // Сумма «ширин-пропорций» → minWidth таблицы: при узком контейнере включается
  // горизонтальный скролл, при широком — fixed-layout распределяет по долям.
  const totalColWidth = useMemo(
    () =>
      columns.reduce((sum, c) => {
        const w = typeof c.width === "number" ? c.width : DEFAULT_COL_WIDTH;
        return sum + w;
      }, 0),
    [columns],
  );

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortIndicator = (key: string) => {
    if (sortKey !== key) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
    return <span style={{ marginLeft: 4 }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="wb-exports-scroll">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="wb-secondary-button" onClick={onBack}>
          ← Назад к выгрузкам
        </button>
      </div>

      <section className="wb-card" style={{ padding: "clamp(12px, 1vw, 16px)" }}>
        <div className="wb-card-header">
          <div>
            <h2>{title}</h2>
            {subtitle && (
              <p className="wb-card-meta">
                {isLoading ? "Загружаем..." : subtitle.replace("{count}", String(filtered.length))}
              </p>
            )}
          </div>
          <div className="wb-inline-badges" style={{ alignItems: "center", gap: 8 }}>
            {filterRow && (
              <input
                className="wb-input"
                placeholder="Поиск..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 200 }}
              />
            )}
            {extraControls}
          </div>
        </div>

        {error && (
          <p style={{ color: "var(--color-danger, #f87171)", padding: "8px 0" }}>{error}</p>
        )}

        {!isLoading && headerSlot && headerSlot(rows)}

        {isLoading ? (
          <p style={{ ...mutedStyle, padding: "24px 0" }}>Загружаем данные из БД...</p>
        ) : filtered.length === 0 ? (
          <p style={{ ...mutedStyle, padding: "24px 0" }}>Данных нет</p>
        ) : (
          <div ref={scrollRef} className="wb-table-wrap">
            <table
              className="wb-data-table"
              style={{
                // border-collapse НЕ трогаем: .wb-data-table ставит separate +
                // border-spacing:0 намеренно — collapse ломает фон sticky-шапки.
                width: "100%",
                minWidth: totalColWidth,
                tableLayout: "fixed",
              }}
            >
              <colgroup>
                {columns.map((col) => (
                  <col
                    key={col.key}
                    style={{ width: col.width ?? DEFAULT_COL_WIDTH }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      style={{
                        ...thStyle,
                        cursor: col.sortValue ? "pointer" : "default",
                        userSelect: "none",
                      }}
                      onClick={col.sortValue ? () => handleSort(col.key) : undefined}
                    >
                      {col.label}{col.sortValue && sortIndicator(col.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paddingTop > 0 && (
                  <tr aria-hidden style={{ height: paddingTop }}>
                    <td colSpan={columns.length} style={{ padding: 0, border: "none" }} />
                  </tr>
                )}
                {virtualItems.map((vi) => {
                  const row = filtered[vi.index];
                  if (!row) return null;
                  return <RawTableRow key={getRowKey(row)} row={row} columns={columns} />;
                })}
                {paddingBottom > 0 && (
                  <tr aria-hidden style={{ height: paddingBottom }}>
                    <td colSpan={columns.length} style={{ padding: 0, border: "none" }} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && filtered.length > 0 && (
          <div style={{ padding: "10px 0 0" }}>
            <span style={{ ...mutedStyle, fontSize: 11 }}>
              Показано {filtered.length} строк (всего загружено {rows.length})
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
