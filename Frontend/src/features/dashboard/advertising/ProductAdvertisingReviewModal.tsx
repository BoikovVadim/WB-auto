import { Modal } from "../../../components/Modal";
import { formatMoney } from "../../../formatters";
import type {
  ClusterAutomationStatus,
  ClusterReviewAction,
} from "../../../api/syncClientClusterAutomation";
import type { ReviewClusterInput } from "./useClusterAutomation";

type Props = {
  status: ClusterAutomationStatus;
  busy: boolean;
  onReview: (input: ReviewClusterInput) => void;
  onClose: () => void;
};

const ACTIONS: { action: ClusterReviewAction; label: string; cls: string; title: string }[] = [
  { action: "approve", label: "В работу", cls: "wb-review-btn--approve", title: "Передать кластер автоматике — дальше им управляет CPO-правило" },
  { action: "reject", label: "В чёрный список", cls: "wb-review-btn--reject", title: "Нерелевантен: автоматика всегда держит выключенным" },
  { action: "protect", label: "Защитить", cls: "wb-review-btn--protect", title: "Всегда активен: автоматика не выключает даже при высоком CPO" },
];

/**
 * Модерация новых кластеров, которые ВБ добавил в РК после baseline. До решения человека
 * движок их НЕ трогает (держит текущее состояние на WB). По каждому: предв. CPO (куда
 * попадёт после «В работу») и три исхода. «Предв. CPO» = расход / max(заказы РК, JAM);
 * для свежего кластера обычно ещё нет данных → «—».
 */
export function ProductAdvertisingReviewModal({ status, busy, onReview, onClose }: Props) {
  const pending = status.clusters.filter((c) => c.reviewStatus === "pending");
  const maxCpo = status.maxCpo;

  return (
    <Modal title={`Новые кластеры на проверке (${pending.length})`} onClose={onClose} width={680}>
      {pending.length === 0 ? (
        <p className="wb-empty-copy" style={{ padding: 16 }}>
          Новых кластеров на проверке нет. Когда ВБ добавит в РК новый кластер, он появится здесь
          и не попадёт в автоматику, пока вы не примете решение.
        </p>
      ) : (
        <div className="wb-review-list">
          {pending.map((c) => {
            const overMax =
              c.lastCpo !== null && maxCpo !== null ? c.lastCpo > maxCpo : null;
            return (
              <div key={c.normalizedClusterName} className="wb-review-row">
                <div className="wb-review-row__info">
                  <span className="wb-review-row__name" title={c.normalizedClusterName}>
                    {c.normalizedClusterName}
                  </span>
                  <span className="wb-review-row__cpo">
                    предв. CPO: {c.lastCpo !== null ? formatMoney(c.lastCpo) : "—"}
                    {overMax !== null && (
                      <span className={overMax ? "wb-review-row__over" : "wb-review-row__within"}>
                        {overMax ? "выше макс" : "в пределах"}
                      </span>
                    )}
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
                        onReview({
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
