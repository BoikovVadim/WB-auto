import { useCallback, useMemo, useState } from "react";

import { formatMoney, formatDateWithWeekday } from "../../formatters";
import type { CostSumMatrix } from "./useCostSumMatrix";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Props = {
  products: ProductListItem[];
  /** Today's «С/с продаж» per product (заказы × выкуп × себестоимость) — computed server-side. */
  costSumValues: Map<number, number>;
  /** Historical «С/с продаж» matrix (snapshot, стартует с момента запуска) — computed server-side. */
  costSumMatrix: CostSumMatrix;
  onBack: () => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_CELL: CellContent = {
  display: <span style={{ opacity: 0.3 }}>—</span>,
  copy: "",
};

function moneyCell(value: number | null): CellContent {
  if (value == null || value === 0) return EMPTY_CELL;
  return { display: formatMoney(value), copy: value.toFixed(2) };
}

export function DashboardCostSumDetailSection({
  products,
  costSumValues,
  costSumMatrix,
  onBack,
}: Props) {
  const today = todayIso();

  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colDate, setColDate] = useState(140);

  const matrixByNmId = useMemo(
    () => new Map(costSumMatrix.products.map((p) => [p.nmId, p.values])),
    [costSumMatrix.products],
  );

  const pastDates = useMemo(() => {
    const result: string[] = [];
    for (const d of costSumMatrix.dates) {
      if (d !== today) result.push(d);
    }
    return result;
  }, [costSumMatrix.dates, today]);

  // Totals: index 0 = today, index 1+ = pastDates[i-1]
  const dateTotals = useMemo(() => {
    const totals = new Array<number>(1 + pastDates.length).fill(0);
    for (const product of products) {
      if (product.nmId === null) continue;
      const v = costSumValues.get(product.nmId);
      if (v !== undefined) totals[0] += v;
    }
    const dateToTotalIdx = new Map<string, number>();
    pastDates.forEach((d, i) => dateToTotalIdx.set(d, i + 1));
    for (const row of costSumMatrix.products) {
      for (let i = 0; i < row.values.length; i++) {
        const v = row.values[i];
        if (v == null) continue;
        const d = costSumMatrix.dates[i];
        if (d == null || d === today) continue;
        const totalIdx = dateToTotalIdx.get(d);
        if (totalIdx != null) totals[totalIdx] += v;
      }
    }
    return totals;
  }, [pastDates, products, costSumValues, costSumMatrix.products, costSumMatrix.dates, today]);

  const matrixIdxByDate = useMemo(() => {
    const m = new Map<string, number>();
    costSumMatrix.dates.forEach((d, i) => m.set(d, i));
    return m;
  }, [costSumMatrix.dates]);

  const pinnedCol: DateColumn = useMemo(
    () => ({
      key: today,
      headerLabel: formatDateWithWeekday(today),
      totalDisplay: dateTotals[0] > 0 ? formatMoney(dateTotals[0]) : "—",
      accent: true,
    }),
    [today, dateTotals],
  );

  const dataCols: DateColumn[] = useMemo(
    () =>
      pastDates.map((d, i) => ({
        key: d,
        headerLabel: formatDateWithWeekday(d),
        totalDisplay: (dateTotals[i + 1] ?? 0) > 0 ? formatMoney(dateTotals[i + 1]!) : "—",
      })),
    [pastDates, dateTotals],
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
    [products],
  );

  const getPinnedCell = useCallback(
    (rowIdx: number): CellContent => {
      const p = products[rowIdx];
      if (!p || p.nmId === null) return EMPTY_CELL;
      const v = costSumValues.get(p.nmId);
      return moneyCell(v ?? null);
    },
    [products, costSumValues],
  );

  const getCell = useCallback(
    (rowIdx: number, dataColIdx: number): CellContent => {
      const p = products[rowIdx];
      if (!p || p.nmId === null) return EMPTY_CELL;
      const d = pastDates[dataColIdx];
      if (d == null) return EMPTY_CELL;
      const matrixIdx = matrixIdxByDate.get(d);
      if (matrixIdx == null) return EMPTY_CELL;
      const values = matrixByNmId.get(p.nmId);
      const v = values ? (values[matrixIdx] ?? null) : null;
      return moneyCell(v);
    },
    [products, pastDates, matrixIdxByDate, matrixByNmId],
  );

  return (
    <VirtualMatrixTable
      title="С/с продаж"
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
      idCol={{
        width: colId,
        setWidth: setColId,
        minWidth: 60,
        headerLabel: "ID товара",
      }}
      nameCol={{
        width: colName,
        setWidth: setColName,
        minWidth: 80,
        headerLabel: "Название товара",
      }}
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
