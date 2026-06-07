import { useEffect, useState } from "react";

import {
  fetchProductAutomationDetail,
  setProductAutomationMode,
  type ProductAutomationDetail,
} from "../../../api/syncClientClusterAutomation";
import { Modal } from "../../../components/Modal";
import { ProductAdvertisingAutomationPanel } from "./ProductAdvertisingAutomationPanel";
import { refreshProductAutomationStatuses } from "./useProductAutomationStatuses";

const EMPTY_DETAIL: ProductAutomationDetail = {
  nmId: 0,
  mode: "off",
  campaigns: [],
  counts: { active: 0, blacklisted: 0, high: 0, drrHeld: 0 },
};

/**
 * Модалка автоматизации по ТОВАРУ (открывается кликом по ячейке «Авто» в таблице товаров).
 * Включает/выключает автоматизацию сразу для всех кампаний товара через единый движок CPO:
 *   - чекбокс «Автоматизация» → preview (расчёт без записи на WB) / off
 *   - кнопка «Включить автоматизацию» → live (реально вкл/выкл кластеры на WB) / обратно в preview
 * Счётчики (актив/чёрный/искл. по CPO) — агрегат по всем кампаниям; наполняются после preview.
 * Переиспользует ту же панель, что и детальный экран РК.
 */
export function ProductAutomationModal(props: {
  nmId: number;
  productName: string;
  onClose: () => void;
}) {
  const { nmId, productName, onClose } = props;
  const [detail, setDetail] = useState<ProductAutomationDetail>({ ...EMPTY_DETAIL, nmId });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProductAutomationDetail(nmId)
      .then((value) => {
        if (!cancelled) {
          setDetail(value);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить статус автоматизации.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nmId]);

  const applyMode = async (mode: ProductAutomationDetail["mode"]) => {
    setBusy(true);
    setError(null);
    try {
      const next = await setProductAutomationMode(nmId, mode);
      setDetail(next);
      // Обновляем сводную карту → бейдж в колонке «Авто» сразу отражает новый режим.
      void refreshProductAutomationStatuses();
    } catch {
      setError("Не удалось сменить режим автоматизации.");
    } finally {
      setBusy(false);
    }
  };

  const campaignsCount = detail.campaigns.length;

  return (
    <Modal title={`Автоматизация · ${productName}`} onClose={onClose} width={520}>
      {loading ? (
        <p style={{ color: "var(--wb-text-muted)" }}>Загрузка…</p>
      ) : campaignsCount === 0 ? (
        <p style={{ color: "var(--wb-text-muted)" }}>У товара нет рекламных кампаний.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--wb-text-muted)" }}>
            Управление кластерами по CPO сразу для всех кампаний товара ({campaignsCount}). CPO ≤
            макс. CPO товара → кластер включается, выше → исключается. «Предпросмотр» считает без
            записи на WB; «Включить автоматизацию» применяет к боевым РК и держит состав каждые 10
            минут.
          </p>

          <ProductAdvertisingAutomationPanel
            mode={detail.mode}
            counts={detail.counts}
            busy={busy}
            alwaysShowCounts
            onToggle={(enabled) => void applyMode(enabled ? "preview" : "off")}
            actions={
              <button
                type="button"
                disabled={busy}
                onClick={() => void applyMode(detail.mode === "live" ? "preview" : "live")}
                style={{
                  fontSize: "11px",
                  padding: "2px 8px",
                  cursor: busy ? "default" : "pointer",
                  border: "1px solid var(--wb-border, #ddd)",
                  borderRadius: "6px",
                  background: detail.mode === "live" ? "#fff" : "#1f8a4c",
                  color: detail.mode === "live" ? "var(--wb-text-main)" : "#fff",
                }}
              >
                {detail.mode === "live" ? "В предпросмотр" : "Включить автоматизацию"}
              </button>
            }
          />

          {error ? (
            <p style={{ margin: 0, fontSize: "12px", color: "#c0392b" }}>{error}</p>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--wb-text-muted)" }}>
              Кампании товара
            </span>
            {detail.campaigns.map((campaign) => (
              <div
                key={campaign.advertId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  fontSize: "12px",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {campaign.name ?? `РК ${String(campaign.advertId)}`}
                </span>
                <span style={{ color: "var(--wb-text-muted)", whiteSpace: "nowrap" }}>
                  {campaign.mode === "live"
                    ? "вкл"
                    : campaign.mode === "preview"
                      ? "предпросмотр"
                      : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
