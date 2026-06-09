import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchQueryFrequenciesPage,
  type RawQueryFrequencyRow,
} from "../../api/syncClientCore";
import { mutedStyle } from "./RawTableSection.styles";
import { cacheSessionJson, getCachedSessionJson } from "../../api/sessionJsonCache";

const PAGE_SIZE = 100;
// Кэшируем только дефолтную первую страницу (частота↓, без поиска) — она грузится при заходе/F5.
const FREQ_DEFAULT_CACHE_KEY = "raw-query-frequencies-default";
type CachedFreqPage = { rows: RawQueryFrequencyRow[]; total: number };

type SortKey = "monthly_frequency" | "query_text" | "subject_name";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
  return <span style={{ marginLeft: 4 }}>{dir === "asc" ? "↑" : "↓"}</span>;
}

export function DashboardQueryFrequenciesSection({ onBack }: { onBack: () => void }) {
  // Первый кадр дефолтной страницы из кэша — без ожидания сети; скелетон только без кэша.
  const cachedDefault = getCachedSessionJson<CachedFreqPage>(FREQ_DEFAULT_CACHE_KEY);
  const [rows, setRows] = useState<RawQueryFrequencyRow[]>(cachedDefault?.rows ?? []);
  const [total, setTotal] = useState<number>(cachedDefault?.total ?? 0);
  const [isLoading, setIsLoading] = useState(cachedDefault == null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("monthly_frequency");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Зеркало rows: скелетон/сброс показываем только когда показывать нечего (тихая ревалидация).
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; });

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
  }, []);

  const loadFirstPage = useCallback(
    async (sk: SortKey, sd: SortDir, q: string, signal?: AbortSignal) => {
      const isDefault = sk === "monthly_frequency" && sd === "desc" && !q;
      if (rowsRef.current.length === 0) setIsLoading(true);
      try {
        const page = await fetchQueryFrequenciesPage({
          limit: PAGE_SIZE,
          offset: 0,
          search: q || undefined,
          sortBy: sk,
          dir: sd,
        });
        if (signal?.aborted) return;
        setRows(page.rows);
        setTotal(page.total);
        if (isDefault) {
          cacheSessionJson<CachedFreqPage>(FREQ_DEFAULT_CACHE_KEY, { rows: page.rows, total: page.total });
        }
      } catch {
        if (!signal?.aborted && rowsRef.current.length === 0) { setRows([]); setTotal(0); }
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadFirstPage(sortKey, sortDir, search, controller.signal);
    return () => controller.abort();
  }, [sortKey, sortDir, search, loadFirstPage]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) { setSortDir((d) => (d === "asc" ? "desc" : "asc")); return prev; }
      setSortDir("desc");
      return key;
    });
  }, []);

  const handleLoadMore = useCallback(async () => {
    setIsLoadingMore(true);
    // Фиксируем сортировку/поиск/смещение на момент запроса. Если за время запроса
    // пользователь сменил сортировку или поиск (эффект выше сбросит rows), ответ
    // относится к устаревшему списку — отбрасываем его, чтобы не дублировать и не
    // перемешивать строки.
    const reqSortKey = sortKey;
    const reqSortDir = sortDir;
    const reqSearch = search;
    const reqOffset = rows.length;
    try {
      const page = await fetchQueryFrequenciesPage({
        limit: PAGE_SIZE,
        offset: reqOffset,
        search: reqSearch || undefined,
        sortBy: reqSortKey,
        dir: reqSortDir,
      });
      setRows((prev) => {
        if (
          reqSortKey !== sortKey ||
          reqSortDir !== sortDir ||
          reqSearch !== search ||
          reqOffset !== prev.length
        ) {
          return prev;
        }
        return [...prev, ...page.rows];
      });
      if (
        reqSortKey === sortKey &&
        reqSortDir === sortDir &&
        reqSearch === search
      ) {
        setTotal(page.total);
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [rows.length, search, sortKey, sortDir]);

  const hasMore = rows.length < total;

  return (
    <div className="wb-exports-scroll">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="wb-secondary-button" onClick={onBack}>
          ← Назад к выгрузкам
        </button>
      </div>

      <section className="wb-card" style={{ padding: "clamp(12px, 1vw, 16px)" }}>
        <div className="wb-card-header">
          <h2>Частоты поисковых запросов</h2>
          <input
            className="wb-input"
            placeholder="Поиск..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{ width: 240 }}
          />
        </div>

        {isLoading ? (
          <p style={{ ...mutedStyle, padding: "24px 0" }}>Загружаем...</p>
        ) : rows.length === 0 ? (
          <p style={{ ...mutedStyle, padding: "24px 0" }}>Ничего не найдено</p>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="wb-data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th
                      style={{ width: 340, cursor: "pointer", userSelect: "none" }}
                      onClick={() => handleSort("query_text")}
                    >
                      Поисковая фраза<SortIcon active={sortKey === "query_text"} dir={sortDir} />
                    </th>
                    <th
                      style={{ width: 140, cursor: "pointer", userSelect: "none" }}
                      onClick={() => handleSort("monthly_frequency")}
                    >
                      Частота / мес.<SortIcon active={sortKey === "monthly_frequency"} dir={sortDir} />
                    </th>
                    <th
                      style={{ width: 180, cursor: "pointer", userSelect: "none" }}
                      onClick={() => handleSort("subject_name")}
                    >
                      Предмет<SortIcon active={sortKey === "subject_name"} dir={sortDir} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.normalizedQueryText}>
                      <td>{row.queryText}</td>
                      <td className="wb-table-cell--numeric">
                        {row.monthlyFrequency != null ? (
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>
                            {row.monthlyFrequency.toLocaleString("ru")}
                          </span>
                        ) : (
                          <span style={mutedStyle}>—</span>
                        )}
                      </td>
                      <td>{row.subjectName ?? <span style={mutedStyle}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasMore && (
              <div style={{ padding: "16px 0 4px", textAlign: "center" }}>
                <button
                  className="wb-secondary-button"
                  style={{ padding: "8px 28px", fontSize: 13 }}
                  disabled={isLoadingMore}
                  onClick={handleLoadMore}
                >
                  {isLoadingMore
                    ? "Загружаем..."
                    : `Показать ещё 100 · осталось ${(total - rows.length).toLocaleString("ru")}`}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
