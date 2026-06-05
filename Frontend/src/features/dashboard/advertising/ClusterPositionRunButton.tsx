import { usePositionContext } from "./useClusterPositions";

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 2L10 6L3 10V2Z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="currentColor" />
    </svg>
  );
}

/**
 * Иконка-пуск глобального обхода позиций (справа от «История изменений»).
 * Идёт по кластерам в ТЕКУЩЕМ порядке/экране (orderedClusterNames из секции), заполняя
 * колонку «Позиция товара». Повторный клик во время обхода — остановка.
 */
export function ClusterPositionRunButton() {
  const ctx = usePositionContext();
  if (!ctx) return null;
  const { runningAll, progress, runAll, cancelAll, orderedClusterNames } = ctx;
  const disabled = !runningAll && orderedClusterNames.length === 0;

  return (
    <button
      type="button"
      className={`wb-toggle-pill wb-toggle-pill--compact${runningAll ? " active" : ""}`}
      disabled={disabled}
      onClick={() => (runningAll ? cancelAll() : runAll(orderedClusterNames))}
      title={
        runningAll
          ? "Остановить обход позиций"
          : "Спарсить позиции по всем кластерам в текущем порядке"
      }
      style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}
    >
      {runningAll ? <StopIcon /> : <PlayIcon />}
      <span>
        {runningAll ? `${progress.done}/${progress.total}` : "Позиции"}
      </span>
    </button>
  );
}
