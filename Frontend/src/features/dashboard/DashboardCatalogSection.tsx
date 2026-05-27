import { useEffect, useState } from "react";

import type { ProductCatalogItem } from "../../api/syncClientAdvertisingSnapshotTypes";
import { fetchProductCatalog } from "../../api/syncClientCore";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const tdStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  verticalAlign: "middle",
  whiteSpace: "nowrap",
};

const thStyle: React.CSSProperties = {
  padding: "7px 10px",
  textAlign: "left",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--color-text-muted, #888)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid var(--color-border, #2a2a3a)",
  whiteSpace: "nowrap",
};

export function DashboardCatalogSection(props: { onBack?: () => void }) {
  const [items, setItems] = useState<ProductCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchProductCatalog()
      .then((res) => setItems(res.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Ошибка загрузки"))
      .finally(() => setIsLoading(false));
  }, []);

  const filtered = items.filter((item) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      item.vendorCode.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      item.brandName.toLowerCase().includes(q) ||
      item.subjectName.toLowerCase().includes(q) ||
      (item.categoryName ?? "").toLowerCase().includes(q) ||
      String(item.nmId).includes(q)
    );
  });

  const totalActive = items.reduce((s, x) => s + x.campaignCounts.active, 0);

  return (
    <div className="wb-exports-scroll">
      {props.onBack && (
        <div>
          <button className="wb-secondary-button" onClick={props.onBack}>
            ← Назад к выгрузкам
          </button>
        </div>
      )}

      <section className="wb-card" style={{ padding: "clamp(12px, 1vw, 16px)" }}>
        <div className="wb-card-header">
          <div>
            <h2>Каталог товаров</h2>
            <p className="wb-card-meta">
              {isLoading
                ? "Загружаем..."
                : `${items.length} товаров · активных РК: ${totalActive}`}
            </p>
          </div>
          <div>
            <input
              className="wb-input"
              placeholder="Поиск по артикулу, названию, бренду..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 240 }}
            />
          </div>
        </div>

        {error && (
          <p style={{ color: "var(--color-danger, #f87171)" }}>{error}</p>
        )}

        {isLoading ? (
          <p style={{ color: "var(--color-text-muted, #888)", padding: "16px 0" }}>Загружаем каталог...</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="wb-data-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
              <thead>
                <tr>
                  <th style={thStyle}>nmId</th>
                  <th style={thStyle}>Артикул</th>
                  <th style={thStyle}>Название</th>
                  <th style={thStyle}>Бренд</th>
                  <th style={thStyle}>Категория</th>
                  <th style={thStyle}>Предмет</th>
                  <th style={thStyle}>Кампаний</th>
                  <th style={thStyle}>Активных РК</th>
                  <th style={thStyle}>Первый раз</th>
                  <th style={thStyle}>Синхр.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.nmId}>
                    <td style={{ ...tdStyle, color: "var(--color-text-muted, #888)", fontFamily: "monospace" }}>
                      {item.nmId}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600, fontFamily: "monospace" }}>
                      {item.vendorCode}
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}
                      title={item.name}>
                      {item.name || "—"}
                    </td>
                    <td style={tdStyle}>{item.brandName || "—"}</td>
                    <td style={tdStyle}>{item.categoryName || "—"}</td>
                    <td style={tdStyle}>{item.subjectName || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{item.campaignCounts.total}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      {item.campaignCounts.active > 0 ? (
                        <span style={{ color: "var(--color-success, #4caf50)", fontWeight: 600 }}>
                          {item.campaignCounts.active}
                        </span>
                      ) : (
                        <span style={{ color: "var(--color-text-muted, #888)" }}>0</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: "var(--color-text-muted, #888)" }}>
                      {formatDate(item.firstSeenAt)}
                    </td>
                    <td style={{ ...tdStyle, color: "var(--color-text-muted, #888)" }}>
                      {formatDate(item.syncedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
