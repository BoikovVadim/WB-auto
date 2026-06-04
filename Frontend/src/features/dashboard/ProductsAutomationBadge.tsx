import type { ReactNode } from "react";

import type { ProductAutomationStatusEntry } from "../../api/syncClientClusterAutomation";

/**
 * Бейдж статуса автоматизации товара для колонки «Авто». Бинарно: live → зелёный «вкл»
 * (реально работает на WB), предпросмотр → серый «выкл» (считает, но не применяет), нет
 * автоматизации → «—». Кол-во кластеров на проверке — в отдельной колонке «На пров.».
 */
export function renderAutomationBadge(entry: ProductAutomationStatusEntry | undefined): ReactNode {
  if (!entry || entry.mode === "off") {
    return <span style={{ color: "var(--wb-text-muted)" }}>—</span>;
  }
  const isLive = entry.mode === "live";
  const title = isLive
    ? `Автоматизация работает (live)${entry.campaignsWithAutomation > 1 ? `, кампаний: ${String(entry.campaignsWithAutomation)}` : ""}`
    : `Автоматизация в предпросмотре — считает, но не применяет${entry.campaignsWithAutomation > 1 ? `, кампаний: ${String(entry.campaignsWithAutomation)}` : ""}`;
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        fontSize: "10px",
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: "6px",
        whiteSpace: "nowrap",
        background: isLive ? "#1f8a4c" : "rgba(0,0,0,0.06)",
        color: isLive ? "#fff" : "var(--wb-text-muted)",
      }}
    >
      {isLive ? "вкл" : "выкл"}
    </span>
  );
}
