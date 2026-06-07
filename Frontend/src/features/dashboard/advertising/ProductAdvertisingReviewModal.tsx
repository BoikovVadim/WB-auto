import { useCallback, useEffect, useRef, useState } from "react";

import { Modal } from "../../../components/Modal";
import { formatMoney } from "../../../formatters";
import {
  fetchPendingClusters,
  type ClusterReviewAction,
  type PendingClusterRow,
} from "../../../api/syncClientClusterAutomation";
import type { ReviewClusterInput } from "./useClusterAutomation";
import {
  readClusterReviewDraft,
  writeClusterReviewDraft,
} from "./clusterReviewDraftStorage";
import { retryWithBackoff } from "../../../api/retryWithBackoff";
import { isTransientHttpError } from "../../../api/syncClientHttp";

type Props = {
  nmId: number;
  advertId: number;
  /** Порог (макс. CPO товара) — для пометки «выше макс / в пределах». */
  maxCpo: number | null;
  busy: boolean;
  onReview: (input: ReviewClusterInput) => Promise<void>;
  onClose: () => void;
};

// Сегментированный контрол «Авто · Белый · Чёрный» — та же тройка и тот же вид, что в
// «Настройке фильтров» (классы wb-filter-role). Маппинг на исходы модерации:
//   Авто = approve (в работу — дальше управляет CPO-правило),
//   Белый = protect (всегда активен), Чёрный = reject (всегда выключен).
const ACTIONS: { action: ClusterReviewAction; label: string; cls: string; title: string }[] = [
  { action: "approve", label: "Авто", cls: "", title: "В работу — кластером управляет автоматика по CPO" },
  { action: "protect", label: "Белый", cls: "wb-filter-role__btn--white", title: "Защитить — всегда активен, автоматика не выключает даже при высоком CPO" },
  { action: "reject", label: "Чёрный", cls: "wb-filter-role__btn--black", title: "В чёрный список — всегда выключен, автоматика не включает" },
];

function formatCount(n: number | null): string {
  if (n === null) return "—";
  return Math.round(n).toLocaleString("ru-RU");
}

/**
 * Модерация новых кластеров, которые ВБ добавил в РК после baseline. До решения человека
 * движок их НЕ трогает. По каждому: частота запроса и JAM-заказы (сигналы релевантности) +
 * предв. CPO (куда попадёт после «В работу») и три исхода.
 */
export function ProductAdvertisingReviewModal({ nmId, advertId, maxCpo, busy, onReview, onClose }: Props) {
  const [rows, setRows] = useState<PendingClusterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Выбор решения по каждому кластеру (normalizedClusterName → действие). Не применяется
  // сразу: запоминается, персистится в localStorage (переживает F5) и улетает на бэкенд
  // только по «Сохранить». Повторный клик по выбранному сегменту снимает выбор.
  const [selections, setSelections] = useState<Map<string, ClusterReviewAction>>(
    () => new Map(Object.entries(readClusterReviewDraft(nmId, advertId))),
  );
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchPendingClusters(nmId, advertId)
      .then((r) => {
        if (isMountedRef.current) setRows(r);
      })
      .catch(() => {
        /* keep previous */
      })
      .finally(() => {
        if (isMountedRef.current) setLoading(false);
      });
  }, [nmId, advertId]);

  useEffect(() => {
    isMountedRef.current = true;
    load();
    return () => {
      isMountedRef.current = false;
    };
  }, [load]);

  const setSelection = useCallback(
    (name: string, action: ClusterReviewAction) => {
      setSelections((prev) => {
        const next = new Map(prev);
        if (next.get(name) === action) next.delete(name);
        else next.set(name, action);
        writeClusterReviewDraft(nmId, advertId, Object.fromEntries(next));
        return next;
      });
    },
    [nmId, advertId],
  );

  // Кол-во выбранных решений среди реально присутствующих строк (без «висящих» в черновике).
  const selectedCount = rows.reduce(
    (acc, r) => acc + (selections.has(r.normalizedClusterName) ? 1 : 0),
    0,
  );

  const handleSave = useCallback(async () => {
    const targets = rows.filter((r) => selections.has(r.normalizedClusterName));
    if (targets.length === 0) return;
    setSaving(true);
    setError(null);
    let anyFailed = false;
    // Применяем ПОСЛЕДОВАТЕЛЬНО (reviewCluster возвращает полный снапшот статуса и защищён
    // generation-guard — параллель гонялась бы). Каждый кластер ретраим на транзиентных
    // ошибках (502 в окне рестарта бэка после деплоя), чтобы решение пережило деплой.
    // Успешные сразу убираем из строк и черновика; упавшие ОСТАВЛЯЕМ выбранными — выбор
    // персистится и переживёт перезагрузку, человек дожмёт «Сохранить», не начиная заново.
    for (const r of targets) {
      const action = selections.get(r.normalizedClusterName);
      if (!action) continue;
      try {
        await retryWithBackoff(
          () =>
            onReview({
              normalizedClusterName: r.normalizedClusterName,
              clusterName: r.normalizedClusterName,
              action,
            }),
          { shouldRetry: isTransientHttpError },
        );
        setRows((prev) => prev.filter((x) => x.normalizedClusterName !== r.normalizedClusterName));
        setSelections((prev) => {
          const next = new Map(prev);
          next.delete(r.normalizedClusterName);
          writeClusterReviewDraft(nmId, advertId, Object.fromEntries(next));
          return next;
        });
      } catch {
        anyFailed = true;
      }
    }
    if (isMountedRef.current) {
      setSaving(false);
      if (anyFailed) {
        setError("Часть кластеров не удалось применить — выбор сохранён, нажмите «Сохранить» ещё раз.");
      }
      load();
    }
  }, [rows, selections, onReview, load, nmId, advertId]);

  return (
    <Modal
      title={`Новые кластеры на проверке (${rows.length})`}
      onClose={onClose}
      width={760}
      footer={
        <>
          {error ? (
            <span style={{ marginRight: "auto", fontSize: "11px", color: "#c0392b" }}>{error}</span>
          ) : null}
          <button
            type="button"
            className="wb-toggle-pill wb-toggle-pill--compact"
            onClick={onClose}
            disabled={saving}
          >
            Отмена
          </button>
          <button
            type="button"
            className="wb-toggle-pill wb-toggle-pill--compact active"
            onClick={() => void handleSave()}
            disabled={saving || busy || selectedCount === 0}
          >
            {saving ? "Сохранение..." : `Сохранить${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
          </button>
        </>
      }
    >
      {loading && rows.length === 0 ? (
        <p className="wb-empty-copy" style={{ padding: 16 }}>Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="wb-empty-copy" style={{ padding: 16 }}>
          Новых кластеров на проверке нет. Когда ВБ добавит в РК новый кластер, он появится здесь
          и не попадёт в автоматику, пока вы не примете решение.
        </p>
      ) : (
        <div className="wb-review-list">
          {rows.map((c) => {
            const overMax = c.lastCpo !== null && maxCpo !== null ? c.lastCpo > maxCpo : null;
            return (
              <div key={c.normalizedClusterName} className="wb-review-row">
                <div className="wb-review-row__info">
                  <span className="wb-review-row__name" title={c.normalizedClusterName}>
                    {c.normalizedClusterName}
                  </span>
                  <span className="wb-review-row__cpo">
                    <span>частота: {formatCount(c.frequency)}</span>
                    <span>JAM-заказы: {formatCount(c.jamOrders)}</span>
                    <span>
                      предв. CPO: {c.lastCpo !== null ? formatMoney(c.lastCpo) : "—"}
                      {overMax !== null && (
                        <span className={overMax ? "wb-review-row__over" : "wb-review-row__within"}>
                          {overMax ? "выше макс" : "в пределах"}
                        </span>
                      )}
                    </span>
                    {c.suggestedReviewAction !== null && (
                      <span
                        className={
                          c.suggestedReviewAction === "approve"
                            ? "wb-review-row__within"
                            : "wb-review-row__over"
                        }
                        title="Рекомендация мусор-фильтра релевантности (решение принимаете вы)"
                      >
                        {c.suggestedReviewAction === "approve"
                          ? "рекомендация: в работу"
                          : "рекомендация: в чёрный"}
                      </span>
                    )}
                  </span>
                </div>
                <span className="wb-filter-role" role="group" aria-label="Решение по кластеру">
                  {ACTIONS.map(({ action, label, cls, title }) => {
                    const selected = selections.get(c.normalizedClusterName) === action;
                    return (
                      <button
                        key={action}
                        type="button"
                        className={`wb-filter-role__btn${cls ? ` ${cls}` : ""}${selected ? " is-active" : ""}`}
                        disabled={busy || saving}
                        title={title}
                        onClick={() => setSelection(c.normalizedClusterName, action)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
