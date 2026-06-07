import type { ClusterPositionLatest } from "../../../api/syncClientPositions";
import { usePositionContext } from "./useClusterPositions";

/** Иконка «обновить» (круговая стрелка), наследует цвет текста. */
function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M11.5 3.5A5 5 0 1 0 12.5 7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M12.5 1.5V4H10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Тултип-расшифровка позиции: чистая органика vs выдача с рекламой. */
function positionTitle(p: ClusterPositionLatest): string {
  const lines = [
    `Органика (без рекламы): ${p.organicPosition ?? ">300"}`,
    `В выдаче с рекламой: ${p.displayPosition ?? "—"}`,
  ];
  if (p.isAd) lines.push("Реклама заметно поднимает товар в выдаче");
  lines.push(`Просмотрено: ${p.scannedCount ?? "?"}`);
  return lines.join("\n");
}

function renderValue(position: ClusterPositionLatest | undefined, probing: boolean) {
  if (probing) return <span style={{ color: "var(--wb-text-muted, #888)" }}>…</span>;
  if (!position) return <span style={{ color: "var(--wb-text-muted, #888)" }}>—</span>;
  if (
    position.status === "found" &&
    (position.organicPosition !== null || position.displayPosition !== null)
  ) {
    const { organicPosition: org, displayPosition: disp } = position;
    return (
      <span style={{ fontWeight: 600 }} title={positionTitle(position)}>
        {/* Основное — ЧИСТАЯ органика; в скобках мутно — позиция с рекламой, если отличается. */}
        {org !== null ? (
          org
        ) : (
          <span style={{ color: "var(--wb-text-muted, #888)" }}>&gt;300</span>
        )}
        {disp !== null && disp !== org && (
          <span style={{ marginLeft: "3px", fontWeight: 400, color: "var(--wb-text-muted, #888)" }}>
            (показ {disp})
          </span>
        )}
      </span>
    );
  }
  if (position.status === "not_found") {
    return (
      <span
        style={{ color: "var(--wb-text-muted, #888)" }}
        title={`Не в топ-300 (просмотрено ${position.scannedCount ?? "?"})`}
      >
        &gt;300
      </span>
    );
  }
  if (position.status === "throttled") {
    return <span style={{ color: "#c0392b", fontSize: "11px" }} title="WB ограничил частоту (429)">429</span>;
  }
  return <span style={{ color: "#c0392b", fontSize: "11px" }} title="Заблокировано/ошибка замера">блок</span>;
}

/**
 * Ячейка колонки «Позиция товара»: место из последнего снапшота (или «—») + иконка
 * обновления, которая замеряет ИМЕННО этот кластер. Данные/обход — через контекст
 * useClusterPositions (стор позиций, общий для таблицы и глобальной кнопки пуска).
 */
export function ClusterPositionCell(props: { clusterName: string }) {
  const ctx = usePositionContext();
  if (!ctx) return <span style={{ color: "var(--wb-text-muted, #888)" }}>—</span>;

  const position = ctx.getPosition(props.clusterName);
  const probing = ctx.isProbing(props.clusterName);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        width: "100%",
      }}
    >
      {renderValue(position, probing)}
      <button
        type="button"
        disabled={probing}
        onClick={() => ctx.probeOne(props.clusterName)}
        title="Обновить позицию по этому кластеру"
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "2px",
          cursor: probing ? "default" : "pointer",
          color: probing ? "var(--wb-text-muted, #aaa)" : "var(--wb-text-muted, #888)",
          background: "none",
          border: "none",
          lineHeight: 0,
        }}
      >
        <RefreshIcon />
      </button>
    </span>
  );
}
