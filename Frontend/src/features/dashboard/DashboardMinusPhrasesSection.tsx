import { useCallback } from "react";

import { fetchRawMinusPhrases, type RawMinusPhraseRow } from "../../api/syncClientCore";
import { RawTableSection, type ColumnDef } from "./RawTableSection";
import { mutedStyle } from "./RawTableSection.styles";

const columns: ColumnDef<RawMinusPhraseRow>[] = [
  { key: "advertId", label: "ID кампании", width: 100, render: (r) => <span style={{ fontFamily: "monospace" }}>{r.advertId}</span> },
  { key: "nmId", label: "nmId", width: 80, render: (r) => <span style={{ fontFamily: "monospace" }}>{r.nmId}</span> },
  { key: "phrase", label: "Фраза", width: 280, render: (r) => r.phrase },
  { key: "normalizedPhrase", label: "Нормализованная", width: 280, render: (r) => <span style={mutedStyle}>{r.normalizedPhrase}</span> },
  { key: "syncedAt", label: "Синхронизировано", width: 145, render: (r) => r.syncedAt ? <span style={mutedStyle}>{r.syncedAt.slice(0, 16).replace("T", " ")}</span> : <span style={mutedStyle}>—</span> },
];

export function DashboardMinusPhrasesSection({ onBack }: { onBack: () => void }) {
  const fetchData = useCallback(() => fetchRawMinusPhrases({ limit: 2000 }), []);

  return (
    <RawTableSection
      title="Минус-фразы"
      subtitle="{count} фраз · wb_campaign_minus_phrases"
      onBack={onBack}
      fetchData={fetchData}
      cacheKey="minus-phrases"
      columns={columns}
      getRowKey={(r) => `${r.advertId}-${r.nmId}-${r.normalizedPhrase}`}
      filterRow={(r, q) =>
        r.phrase.toLowerCase().includes(q) ||
        String(r.nmId).includes(q) ||
        String(r.advertId).includes(q)
      }
    />
  );
}
