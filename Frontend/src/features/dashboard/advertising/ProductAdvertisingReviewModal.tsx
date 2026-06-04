import { useCallback, useEffect, useRef, useState } from "react";

import { Modal } from "../../../components/Modal";
import { formatMoney } from "../../../formatters";
import {
  fetchPendingClusters,
  type ClusterReviewAction,
  type PendingClusterRow,
} from "../../../api/syncClientClusterAutomation";
import type { ReviewClusterInput } from "./useClusterAutomation";

type Props = {
  nmId: number;
  advertId: number;
  /** Порог (макс. CPO товара) — для пометки «выше макс / в пределах». */
  maxCpo: number | null;
  busy: boolean;
  onReview: (input: ReviewClusterInput) => Promise<void>;
  onClose: () => void;
};

const ACTIONS: { action: ClusterReviewAction; label: string; cls: string; title: string }[] = [
  { action: "approve", label: "В работу", cls: "wb-review-btn--approve", title: "Передать кластер автоматике — дальше им управляет CPO-правило" },
  { action: "reject", label: "В чёрный список", cls: "wb-review-btn--reject", title: "Нерелевантен: автоматика всегда держит выключенным" },
  { action: "protect", label: "Защитить", cls: "wb-review-btn--protect", title: "Всегда активен: автоматика не выключает даже при высоком CPO" },
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

  const handleReview = useCallback(
    async (input: ReviewClusterInput) => {
      // Оптимистично убираем строку, затем шлём действие и перечитываем enriched-список.
      setRows((prev) => prev.filter((r) => r.normalizedClusterName !== input.normalizedClusterName));
      await onReview(input);
      if (isMountedRef.current) load();
    },
    [onReview, load],
  );

  return (
    <Modal title={`Новые кластеры на проверке (${rows.length})`} onClose={onClose} width={760}>
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
                  </span>
                </div>
                <div className="wb-review-row__actions">
                  {ACTIONS.map(({ action, label, cls, title }) => (
                    <button
                      key={action}
                      type="button"
                      className={`wb-review-btn ${cls}`}
                      disabled={busy}
                      title={title}
                      onClick={() =>
                        void handleReview({
                          normalizedClusterName: c.normalizedClusterName,
                          clusterName: c.normalizedClusterName,
                          action,
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
