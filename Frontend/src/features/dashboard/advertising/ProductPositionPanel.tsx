import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchPositionStatus,
  startPositionRun,
  type ClusterPositionLatest,
  type PositionRunStatus,
} from "../../../api/syncClientPositions";

const POLL_INTERVAL_MS = 3000;
const DEFAULT_LIMIT = 20;

/**
 * Панель «Позиции в выдаче» (v1, ручной парсер, 1 IP). Кнопка запускает фоновый обход
 * топ-кластеров товара (зонд search.wb.ru по самому частотному запросу кластера), панель
 * поллит статус и рисует место товара: органическое + рекламный слот. Статусы throttled/
 * blocked показываем честно — это и есть наблюдаемые лимиты на 1 IP.
 */
export function ProductPositionPanel(props: { nmId: number }) {
  const { nmId } = props;
  const [data, setData] = useState<PositionRunStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const status = await fetchPositionStatus(nmId);
      setData(status);
      if (status.status !== "running") clearPoll();
    } catch {
      // молча: панель некритична, статус подтянется на следующем поллинге/запуске
    }
  }, [nmId, clearPoll]);

  // Первичная загрузка ранее собранных позиций (без авто-запуска парсера).
  useEffect(() => {
    void load();
    return clearPoll;
  }, [load, clearPoll]);

  const handleRun = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await startPositionRun(nmId, DEFAULT_LIMIT);
      setData(status);
      clearPoll();
      if (status.status === "running") {
        pollRef.current = setInterval(() => void load(), POLL_INTERVAL_MS);
      }
    } catch {
      setError("Не удалось запустить парсер. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }, [nmId, load, clearPoll]);

  const running = data?.status === "running";
  const items = data?.items ?? [];

  return (
    <div className="wb-card" style={{ marginTop: "12px", padding: "12px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          marginBottom: items.length > 0 ? "10px" : 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <strong style={{ fontSize: "13px" }}>Позиции в выдаче (бета, 1 IP)</strong>
          <span style={{ fontSize: "11px", color: "var(--wb-text-muted, #888)" }}>
            Место товара по топ-кластерам на момент замера. Щадящий темп — обход идёт
            постепенно.
          </span>
        </div>
        <button
          type="button"
          disabled={busy || running}
          onClick={() => void handleRun()}
          style={{
            fontSize: "12px",
            fontWeight: 600,
            padding: "6px 12px",
            cursor: busy || running ? "default" : "pointer",
            whiteSpace: "nowrap",
            border: "1px solid var(--wb-border, #ddd)",
            borderRadius: "6px",
            background: running ? "#fff" : "#1f8a4c",
            color: running ? "var(--wb-text-main)" : "#fff",
          }}
        >
          {running
            ? `Идёт… ${data?.processed ?? 0}/${data?.total ?? 0}`
            : "Запустить парсер"}
        </button>
      </div>

      {error && <p className="wb-advertising-inline-error">{error}</p>}

      {data && (data.status !== "idle" || items.length > 0) && (
        <PositionSummary data={data} />
      )}

      {items.length > 0 && <PositionTable items={items} />}
    </div>
  );
}

function PositionSummary(props: { data: PositionRunStatus }) {
  const d = props.data;
  return (
    <div
      style={{
        fontSize: "11px",
        color: "var(--wb-text-muted, #888)",
        marginBottom: "8px",
        display: "flex",
        gap: "12px",
        flexWrap: "wrap",
      }}
    >
      <span>найдено: {d.found}</span>
      <span>не в топе: {d.notFound}</span>
      <span>троттл (429): {d.throttled}</span>
      {d.blocked > 0 && <span>заблок.: {d.blocked}</span>}
      {d.stoppedEarly && (
        <span style={{ color: "#c0392b" }}>
          IP перегрет — обход остановлен (лимит 1 IP)
        </span>
      )}
    </div>
  );
}

const POSITION_CELL_CENTER: React.CSSProperties = { textAlign: "center" };

function renderPlace(item: ClusterPositionLatest) {
  if (item.status === "found" && item.organicPosition !== null) {
    return (
      <span>
        {item.organicPosition}
        {item.isAd && (
          <span
            title={
              item.adPosition !== null
                ? `Рекламный слот, позиция ${item.adPosition}`
                : "Рекламный слот (буст)"
            }
            style={{
              marginLeft: "4px",
              fontSize: "10px",
              fontWeight: 600,
              color: "#a86a00",
            }}
          >
            рек
          </span>
        )}
      </span>
    );
  }
  if (item.status === "not_found")
    return <span style={{ color: "var(--wb-text-muted, #888)" }}>не в топ-{item.scannedCount ?? "?"}</span>;
  if (item.status === "throttled")
    return <span style={{ color: "#c0392b" }}>троттл</span>;
  if (item.status === "blocked")
    return <span style={{ color: "#c0392b" }}>заблок.</span>;
  return <span style={{ color: "var(--wb-text-muted, #888)" }}>—</span>;
}

function PositionTable(props: { items: ClusterPositionLatest[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--wb-text-muted, #888)", textAlign: "left" }}>
            <th style={{ padding: "4px 8px" }}>Кластер</th>
            <th style={{ padding: "4px 8px" }}>Запрос</th>
            <th style={{ padding: "4px 8px", ...POSITION_CELL_CENTER }}>Место</th>
            <th style={{ padding: "4px 8px", ...POSITION_CELL_CENTER }}>Замер</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <tr
              key={item.normalizedClusterName}
              style={{ borderTop: "1px solid var(--wb-border, #eee)" }}
            >
              <td style={{ padding: "4px 8px" }}>{item.clusterName}</td>
              <td style={{ padding: "4px 8px", color: "var(--wb-text-muted, #888)" }}>
                {item.probeQuery}
              </td>
              <td style={{ padding: "4px 8px", ...POSITION_CELL_CENTER }}>
                {renderPlace(item)}
              </td>
              <td style={{ padding: "4px 8px", ...POSITION_CELL_CENTER, whiteSpace: "nowrap", color: "var(--wb-text-muted, #888)" }}>
                {new Date(item.capturedAt).toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
