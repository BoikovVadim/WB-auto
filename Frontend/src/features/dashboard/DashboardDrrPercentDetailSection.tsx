import { useCallback, useMemo, useState } from "react";

import { formatPercent, formatDateWithWeekday } from "../../formatters";
import type { DrrMatrix } from "./useDrrPercentMatrix";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Props = {
  products: ProductListItem[];
  /** Today's ДРР per product (%, ad spend / revenue) — computed server-side. */
  drrPercentValues: Map<number, number>;
  /** Today's ad spend per product (₽) — числитель взвешенного «Итого» за сегодня. */
  adSpendValues: Map<number, number>;
  /** Today's revenue per product (₽) — знаменатель взвешенного «Итого» за сегодня. */
  revenueValues: Map<number, number>;
  /** Historical ДРР matrix (drr %, spend ₽, revenue ₽ per day) — computed server-side. */
  drrMatrix: DrrMatrix;
  onBack: () => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_CELL: CellContent = {
  display: <span style={{ opacity: 0.3 }}>—</span>,
  copy: "",
};

function pctCell(value: number | null): CellContent {
  if (value == null) return EMPTY_CELL;
  return { display: formatPercent(value), copy: value.toFixed(2) };
}

export function DashboardDrrPercentDetailSection({
  products,
  drrPercentValues,
  adSpendValues,
  revenueValues,
  drrMatrix,
  onBack,
}: Props) {
  const today = todayIso();

  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colDate, setColDate] = useState(140);

  const rowByNmId = useMemo(
    () => new Map(drrMatrix.products.map((p) => [p.nmId, p])),
    [drrMatrix.products],
  );

  const pastDates = useMemo(() => {
    const result: string[] = [];
    for (const d of drrMatrix.dates) {
      if (d !== today) result.push(d);
    }
    return result;
  }, [drrMatrix.dates, today]);

  const matrixIdxByDate = useMemo(() => {
    const m = new Map<string, number>();
    drrMatrix.dates.forEach((d, i) => m.set(d, i));
    return m;
  }, [drrMatrix.dates]);

  // «Итого» за сегодня — взвешенно: Σ общий расход / Σ общая выручка × 100. Расход берём по
  // всем товарам, у кого он есть (включая безвыручечных, чья строка = 100%); выручку — где
  // есть. Нет выручки ни у кого, но есть расход → 100%.
  const todayTotalDisplay = useMemo(() => {
    let spendSum = 0;
    let revSum = 0;
    for (const p of products) {
      if (p.nmId === null) continue;
      const spend = adSpendValues.get(p.nmId);
      if (spend == null || spend <= 0) continue;
      spendSum += spend;
      const rev = revenueValues.get(p.nmId);
      if (rev != null && rev > 0) revSum += rev;
    }
    if (revSum > 0) return formatPercent((spendSum / revSum) * 100);
    return spendSum > 0 ? formatPercent(100) : "—";
  }, [products, adSpendValues, revenueValues]);

  // «Итого» по прошлым дням — взвешенно из матрицы: Σ spend(день) / Σ revenue(день) × 100.
  // spend идёт в числитель по всем ячейкам с расходом (revenue=null у безвыручечных).
  const pastTotalsByDate = useMemo(() => {
    const totals = new Map<string, string>();
    for (const d of pastDates) {
      const idx = matrixIdxByDate.get(d);
      if (idx == null) {
        totals.set(d, "—");
        continue;
      }
      let spendSum = 0;
      let revSum = 0;
      for (const row of drrMatrix.products) {
        const spend = row.spend[idx];
        if (spend == null || spend <= 0) continue;
        spendSum += spend;
        const rev = row.revenue[idx];
        if (rev != null && rev > 0) revSum += rev;
      }
      totals.set(d, revSum > 0 ? formatPercent((spendSum / revSum) * 100) : spendSum > 0 ? formatPercent(100) : "—");
    }
    return totals;
  }, [pastDates, matrixIdxByDate, drrMatrix.products]);

  const pinnedCol: DateColumn = useMemo(
    () => ({
      key: today,
      headerLabel: formatDateWithWeekday(today),
      totalDisplay: todayTotalDisplay,
      accent: true,
    }),
    [today, todayTotalDisplay],
  );

  const dataCols: DateColumn[] = useMemo(
    () =>
      pastDates.map((d) => ({
        key: d,
        headerLabel: formatDateWithWeekday(d),
        totalDisplay: pastTotalsByDate.get(d) ?? "—",
      })),
    [pastDates, pastTotalsByDate],
  );

  const getRowKey = useCallback(
    (rowIdx: number) => {
      const p = products[rowIdx];
      return p ? `${p.vendorCode}-${p.nmId ?? "none"}` : String(rowIdx);
    },
    [products],
  );

  const getLeftLeading = useCallback(
    (rowIdx: number) => {
      const p = products[rowIdx];
      if (!p) {
        return {
          no: { display: String(rowIdx + 1), copy: String(rowIdx + 1) },
          id: EMPTY_CELL,
          name: EMPTY_CELL,
        };
      }
      const displayName =
        p.vendorCode !== "" ? p.vendorCode : p.nmId !== null ? `#${String(p.nmId)}` : "—";
      return {
        no: { display: String(rowIdx + 1), copy: String(rowIdx + 1) },
        id: {
          display: p.nmId !== null ? String(p.nmId) : "—",
          copy: p.nmId !== null ? String(p.nmId) : "",
        },
        name: { display: <span title={displayName}>{displayName}</span>, copy: displayName },
      };
    },
    [products],
  );

  const getPinnedCell = useCallback(
    (rowIdx: number): CellContent => {
      const p = products[rowIdx];
      if (!p || p.nmId === null) return EMPTY_CELL;
      const v = drrPercentValues.get(p.nmId);
      return pctCell(v ?? null);
    },
    [products, drrPercentValues],
  );

  const getCell = useCallback(
    (rowIdx: number, dataColIdx: number): CellContent => {
      const p = products[rowIdx];
      if (!p || p.nmId === null) return EMPTY_CELL;
      const d = pastDates[dataColIdx];
      if (d == null) return EMPTY_CELL;
      const idx = matrixIdxByDate.get(d);
      if (idx == null) return EMPTY_CELL;
      const row = rowByNmId.get(p.nmId);
      const v = row ? (row.drr[idx] ?? null) : null;
      return pctCell(v);
    },
    [products, pastDates, matrixIdxByDate, rowByNmId],
  );

  return (
    <VirtualMatrixTable
      title="ДРР, %"
      onBack={onBack}
      empty={
        products.length === 0 ? (
          <p className="wb-empty-copy" style={{ padding: "32px" }}>
            Нет товаров.
          </p>
        ) : null
      }
      rowCount={products.length}
      getRowKey={getRowKey}
      getLeftLeading={getLeftLeading}
      noCol={{ width: colNo, setWidth: setColNo, minWidth: 36 }}
      idCol={{ width: colId, setWidth: setColId, minWidth: 60, headerLabel: "ID товара" }}
      nameCol={{ width: colName, setWidth: setColName, minWidth: 80, headerLabel: "Название товара" }}
      pinnedCol={pinnedCol}
      getPinnedCell={getPinnedCell}
      dataCols={dataCols}
      dataColWidth={colDate}
      setDataColWidth={setColDate}
      dataColMinWidth={70}
      getCell={getCell}
      hasTotalsRow
    />
  );
}
