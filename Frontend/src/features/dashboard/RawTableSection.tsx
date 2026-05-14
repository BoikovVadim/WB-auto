import React, { useEffect, useState } from "react";

export const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--color-text-muted, #888)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
  borderBottom: "1px solid var(--color-border, #2a2a3a)",
};

export const tdStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  verticalAlign: "middle",
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const mutedStyle: React.CSSProperties = {
  color: "var(--color-text-muted, #888)",
};

export type ColumnDef<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  width?: number | string;
};

type RawTableSectionProps<T> = {
  title: string;
  subtitle?: string;
  onBack: () => void;
  fetchData: () => Promise<T[]>;
  columns: ColumnDef<T>[];
  getRowKey: (row: T) => string;
  filterRow?: (row: T, search: string) => boolean;
  extraControls?: React.ReactNode;
  refetchKey?: number;
};

export function RawTableSection<T>({
  title,
  subtitle,
  onBack,
  fetchData,
  columns,
  getRowKey,
  filterRow,
  extraControls,
  refetchKey = 0,
}: RawTableSectionProps<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    fetchData()
      .then(setRows)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Ошибка загрузки");
      })
      .finally(() => setIsLoading(false));
  }, [fetchData, refetchKey]);

  const filtered =
    filterRow && search
      ? rows.filter((row) => filterRow(row, search.toLowerCase()))
      : rows;

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

        {isLoading ? (
          <p style={{ ...mutedStyle, padding: "24px 0" }}>Загружаем данные из БД...</p>
        ) : filtered.length === 0 ? (
          <p style={{ ...mutedStyle, padding: "24px 0" }}>Данных нет</p>
        ) : (
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
                      style={{ ...thStyle, width: col.width }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
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
            <p style={{ ...mutedStyle, fontSize: 11, padding: "8px 0 0" }}>
              Показано {filtered.length} из {rows.length} строк
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
