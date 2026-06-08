import { useCallback, useEffect, useRef, useState } from "react";

import { Modal } from "../../../components/Modal";
import { formatMoney } from "../../../formatters";
import {
  fetchBidSuggestions,
  type BidSuggestionRow,
} from "../../../api/syncClientClusterAutomation";

type Props = {
  nmId: number;
  advertId: number;
  onClose: () => void;
};

/** Человекочитаемая подпись + класс по причине решения движка. */
const REASON_LABEL: Record<string, { text: string; cls: string }> = {
  up: { text: "повышаем ↑", cls: "wb-review-row__over" },
  down: { text: "понижаем ↓", cls: "wb-review-row__within" },
  at_cap: { text: "на потолке", cls: "wb-review-row__over" },
  at_min: { text: "на минимуме", cls: "wb-review-row__within" },
  frozen: { text: "заморожено (нет позиции)", cls: "" },
  unprofitable: { text: "убыточно (CR низкая)", cls: "wb-review-row__over" },
};

function bid(v: number | null): string {
  return v !== null ? formatMoney(v) : "—";
}

function pos(v: number | null): string {
  return v !== null ? `#${v}` : "—";
}

/**
 * Наблюдение за ставочным движком: по каждому кластеру кампании — замеренная позиция (с
 * рекламой), текущая ставка, желаемая ставка движка и направление (повышаем/понижаем). Только
 * чтение; движок применяет ставки сам (или в dry-run только считает). См. product-cluster-bid.
 */
export function ProductAdvertisingBidSuggestionsModal({ nmId, advertId, onClose }: Props) {
  const [rows, setRows] = useState<BidSuggestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchBidSuggestions(nmId, advertId)
      .then((r) => {
        if (isMountedRef.current) setRows(r.clusters);
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

  return (
    <Modal title={`Предложения движка по ставкам (${rows.length})`} onClose={onClose} width={820}>
      {loading && rows.length === 0 ? (
        <p className="wb-empty-copy" style={{ padding: 16 }}>Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="wb-empty-copy" style={{ padding: 16 }}>
          Движок ещё не считал ставки по этому товару. Появятся после первого круга (раз в 10 мин),
          если ставочный движок включён на этот товар.
        </p>
      ) : (
        <div className="wb-review-list">
          {rows.map((c) => {
            const reason = c.reason ? REASON_LABEL[c.reason] : undefined;
            return (
              <div key={c.normalizedClusterName} className="wb-review-row">
                <div className="wb-review-row__info">
                  <span className="wb-review-row__name" title={c.normalizedClusterName}>
                    {c.normalizedClusterName}
                  </span>
                  <span className="wb-review-row__cpo">
                    <span>позиция: {pos(c.position)}</span>
                    <span>
                      ставка: {bid(c.currentBid)} → <strong>{bid(c.desiredBid)}</strong>
                    </span>
                    <span>потолок: {bid(c.bidCap)}</span>
                    {reason ? (
                      <span className={reason.cls}>{reason.text}</span>
                    ) : null}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
