import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchPricesMatrix,
  priceWithDiscount,
  type PricesMatrixRow,
} from "../../api/syncClientPrices";
import { formatMoney, formatDateWithWeekday } from "../../formatters";
import type { CurrentPriceEntry } from "./useCurrentPrices";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Props = {
  products: ProductListItem[];
  priceCounts: Map<number, CurrentPriceEntry>;
  onBack: () => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type PricesMatrix = {
  dates: string[];
  products: {
    nmId: number;
    prices: (number | null)[];
    discounts: (number | null)[];
  }[];
};

const PRICES_MATRIX_CACHE_KEY = "wb_prices_matrix_v1";
const PRICES_MATRIX_CACHE_DATE = "wb_prices_matrix_v1_date";

function readMatrixCache(): PricesMatrix | null {
  try {
    const savedDate = localStorage.getItem(PRICES_MATRIX_CACHE_DATE);
    if (savedDate !== todayIso()) return null;
    const raw = localStorage.getItem(PRICES_MATRIX_CACHE_KEY);
    return raw ? (JSON.parse(raw) as PricesMatrix) : null;
  } catch {
    return null;
  }
}

function writeMatrixCache(m: PricesMatrix) {
  try {
    localStorage.setItem(PRICES_MATRIX_CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(PRICES_MATRIX_CACHE_DATE, todayIso());
  } catch {
    /* quota */
  }
}

function buildMatrix(rows: PricesMatrixRow[]): PricesMatrix {
  const datesSet = new Set<string>();
  for (const r of rows) datesSet.add(r.priceDate);
  const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1));
  const byNmId = new Map<number, Map<string, { price: number; discount: number }>>();
  for (const r of rows) {
    if (!byNmId.has(r.nmId)) byNmId.set(r.nmId, new Map());
    byNmId.get(r.nmId)!.set(r.priceDate, { price: r.price, discount: r.discount });
  }
  const products = Array.from(byNmId.entries()).map(([nmId, dateMap]) => ({
    nmId,
    prices: dates.map((d) => dateMap.get(d)?.price ?? null),
    discounts: dates.map((d) => dateMap.get(d)?.discount ?? null),
  }));
  return { dates, products };
}

type SortCol = string | null;

function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span style={{ opacity: active ? 1 : 0.3, fontSize: 11 }}>
      {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );
}

const EMPTY_CELL: CellContent = {
  display: <span style={{ opacity: 0.3 }}>—</span>,
  copy: "",
};

function priceCell(value: number | null): CellContent {
  if (value == null) return EMPTY_CELL;
  return { display: formatMoney(value), copy: value.toFixed(2) };
}

/** Фоновый прогрев кэша матрицы цен (best-effort) — лист открывается мгновенно. */
export async function prefetchPricesMatrix(): Promise<void> {
  try {
    writeMatrixCache(buildMatrix(await fetchPricesMatrix()));
  } catch {
    /* best-effort */
  }
}

export function DashboardPricesDetailSection({ products, priceCounts, onBack }: Props) {
  const today = todayIso();

  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colDate, setColDate] = useState(150);

  const [matrix, setMatrix] = useState<PricesMatrix>(
    () => readMatrixCache() ?? { dates: [], products: [] },
  );
  const [loading, setLoading] = useState(false);

  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSortToggle = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return col;
      }
      setSortDir("desc");
      return col;
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPricesMatrix()
      .then((rows) => {
        const m = buildMatrix(rows);
        setMatrix(m);
        writeMatrixCache(m);
      })
      .catch(() => {
        /* keep cached */
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const matrixByNmId = useMemo(
    () => new Map(matrix.products.map((p) => [p.nmId, p])),
    [matrix.products],
  );

  // Закреплённая колонка = сегодня, когда есть live-цены (поллятся каждые 10 мин), иначе
  // последний реальный снапшот. Заголовок показывает настоящую дату (formatDateWithWeekday),
  // т.е. сегодняшнюю, а вчера съезжает в историю. Цена за сегодня берётся из поллинга
  // (priceCounts) — реальная текущая. Раньше закрепляли только дату последнего снапшота
  // (matrix.dates[0]); снапшот пишется ночью, поэтому почти весь день показывалась вчерашняя
  // дата — это и был баг ретроспективы цен. Зеркалит остатки.
  const hasLive = priceCounts.size > 0;
  const latestSnapshotDate = matrix.dates[0] ?? null;
  const pinnedKey = hasLive ? today : latestSnapshotDate;

  const pastDates = useMemo(
    () => matrix.dates.filter((d) => d !== today && d !== pinnedKey),
    [matrix.dates, today, pinnedKey],
  );

  const matrixIdxByDate = useMemo(() => {
    const m = new Map<string, number>();
    matrix.dates.forEach((d, i) => m.set(d, i));
    return m;
  }, [matrix.dates]);

  const getPriceValue = useCallback(
    (nmId: number | null, d: string): number | null => {
      if (nmId === null) return null;
      if (d === today) {
        const entry = priceCounts.get(nmId);
        return entry ? entry.priceWithDiscount : null;
      }
      const row = matrixByNmId.get(nmId);
      if (!row) return null;
      const idx = matrixIdxByDate.get(d);
      if (idx == null) return null;
      const p = row.prices[idx];
      const disc = row.discounts[idx];
      return p != null && disc != null ? priceWithDiscount(p, disc) : null;
    },
    [today, priceCounts, matrixByNmId, matrixIdxByDate],
  );

  const sortedProducts = useMemo(() => {
    if (!sortCol) return products;
    return [...products].sort((a, b) => {
      if (sortCol === "nmId") {
        const av = a.nmId ?? 0;
        const bv = b.nmId ?? 0;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      if (sortCol === "vendorCode") {
        const av = a.vendorCode ?? "";
        const bv = b.vendorCode ?? "";
        return sortDir === "asc"
          ? av.localeCompare(bv, "ru")
          : bv.localeCompare(av, "ru");
      }
      const av = getPriceValue(a.nmId, sortCol) ?? 0;
      const bv = getPriceValue(b.nmId, sortCol) ?? 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [products, sortCol, sortDir, getPriceValue]);

  const pinnedCol: DateColumn | undefined = useMemo(() => {
    if (!pinnedKey) return undefined;
    return {
      key: pinnedKey,
      headerLabel: formatDateWithWeekday(pinnedKey),
      onHeaderClick: () => {
        handleSortToggle(pinnedKey);
      },
      sortIndicator: <SortArrow active={sortCol === pinnedKey} dir={sortDir} />,
      accent: true,
    };
  }, [pinnedKey, sortCol, sortDir, handleSortToggle]);

  const dataCols: DateColumn[] = useMemo(
    () =>
      pastDates.map((d) => ({
        key: d,
        headerLabel: formatDateWithWeekday(d),
        onHeaderClick: () => {
          handleSortToggle(d);
        },
        sortIndicator: <SortArrow active={sortCol === d} dir={sortDir} />,
      })),
    [pastDates, sortCol, sortDir, handleSortToggle],
  );

  const getRowKey = useCallback(
    (rowIdx: number) => {
      const p = sortedProducts[rowIdx];
      return p ? `${p.vendorCode}-${p.nmId ?? "none"}` : String(rowIdx);
    },
    [sortedProducts],
  );

  const getLeftLeading = useCallback(
    (rowIdx: number) => {
      const p = sortedProducts[rowIdx];
      if (!p) {
        return {
          no: { display: String(rowIdx + 1), copy: String(rowIdx + 1) },
          id: EMPTY_CELL,
          name: EMPTY_CELL,
        };
      }
      const displayName =
        p.vendorCode !== ""
          ? p.vendorCode
          : p.nmId !== null
            ? `#${String(p.nmId)}`
            : "—";
      return {
        no: { display: String(rowIdx + 1), copy: String(rowIdx + 1) },
        id: {
          display: p.nmId !== null ? String(p.nmId) : "—",
          copy: p.nmId !== null ? String(p.nmId) : "",
        },
        name: {
          display: <span title={displayName}>{displayName}</span>,
          copy: displayName,
        },
      };
    },
    [sortedProducts],
  );

  const getPinnedCell = useCallback(
    (rowIdx: number): CellContent => {
      if (!pinnedKey) return EMPTY_CELL;
      const p = sortedProducts[rowIdx];
      if (!p) return EMPTY_CELL;
      return priceCell(getPriceValue(p.nmId, pinnedKey));
    },
    [sortedProducts, getPriceValue, pinnedKey],
  );

  const getCell = useCallback(
    (rowIdx: number, dataColIdx: number): CellContent => {
      const p = sortedProducts[rowIdx];
      if (!p) return EMPTY_CELL;
      const d = pastDates[dataColIdx];
      if (d == null) return EMPTY_CELL;
      return priceCell(getPriceValue(p.nmId, d));
    },
    [sortedProducts, pastDates, getPriceValue],
  );

  const toolbar = loading ? (
    <span style={{ fontSize: 12, color: "var(--wb-text-muted)" }}>Обновление…</span>
  ) : null;

  const empty =
    products.length === 0 ? (
      <p className="wb-empty-copy" style={{ padding: "32px" }}>
        Нет товаров.
      </p>
    ) : !pinnedKey && pastDates.length === 0 && !loading ? (
      <p className="wb-empty-copy" style={{ padding: "32px" }}>
        Нет данных. Цены сохраняются автоматически вместе со снапшотом остатков в 01:00 МСК.
      </p>
    ) : null;

  return (
    <VirtualMatrixTable
      title="Цены (со скидкой продавца)"
      toolbar={toolbar}
      onBack={onBack}
      empty={empty}
      rowCount={sortedProducts.length}
      getRowKey={getRowKey}
      getLeftLeading={getLeftLeading}
      noCol={{ width: colNo, setWidth: setColNo, minWidth: 36 }}
      idCol={{
        width: colId,
        setWidth: setColId,
        minWidth: 60,
        headerLabel: "ID товара",
        onHeaderClick: () => {
          handleSortToggle("nmId");
        },
        sortIndicator: <SortArrow active={sortCol === "nmId"} dir={sortDir} />,
      }}
      nameCol={{
        width: colName,
        setWidth: setColName,
        minWidth: 80,
        headerLabel: "Название товара",
        onHeaderClick: () => {
          handleSortToggle("vendorCode");
        },
        sortIndicator: <SortArrow active={sortCol === "vendorCode"} dir={sortDir} />,
      }}
      pinnedCol={pinnedCol}
      getPinnedCell={getPinnedCell}
      dataCols={dataCols}
      dataColWidth={colDate}
      setDataColWidth={setColDate}
      dataColMinWidth={60}
      getCell={getCell}
      hasTotalsRow={false}
    />
  );
}
