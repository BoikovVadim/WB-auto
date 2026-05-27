import React, { useEffect, useMemo, useState } from "react";
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

const PAGE_SIZE = 1000;

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
  /** Optional slot rendered above the table (after header), receives loaded rows. */
  headerSlot?: (rows: T[]) => React.ReactNode;
  /** Column key to sort by on first render. */
  defaultSortKey?: string;
  /** Sort direction applied with defaultSortKey. Defaults to "desc". */
  defaultSortDir?: SortDir;
};

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
  headerSlot,
  defaultSortKey,
  defaultSortDir = "desc",
}: RawTableSectionProps<T>) {
  const [rows, setRows] = useState<T[]>(() => initialData ?? []);
  const [isLoading, setIsLoading] = useState(() => initialData == null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);

  useEffect(() => {
    if (initialData != null && refetchKey === 0) {
      return;
    }
    setIsLoading(true);
    setError(null);
    fetchData()
      .then((data) => { setRows(data); setPage(1); })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Ошибка загрузки");
      })
      .finally(() => setIsLoading(false));
  }, [fetchData, refetchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [search]);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
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
          <>
            <div style={{ overflowX: "auto" }}>
              <table
                className="wb-data-table"
                style={{ width: "100%", borderCollapse: "collapse" }}
              >
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        style={{
                          ...thStyle,
                          width: col.width,
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
                  {pageRows.map((row) => (
                    <tr key={getRowKey(row)}>
                      {columns.map((col) => (
                        <td key={col.key} style={tdStyle} title="">
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0 0", flexWrap: "wrap" }}>
              <span style={{ ...mutedStyle, fontSize: 11 }}>
                Страница {safePage} / {totalPages} · показано {pageRows.length} из {filtered.length} строк (всего {rows.length})
              </span>
              <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                <button
                  className="wb-secondary-button"
                  style={{ padding: "3px 10px", fontSize: 12 }}
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Назад
                </button>
                <button
                  className="wb-secondary-button"
                  style={{ padding: "3px 10px", fontSize: 12 }}
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Вперёд →
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
