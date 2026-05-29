import { useCallback, useMemo, useState } from "react";

import { formatMoney } from "../../formatters";
import type { RevenueMatrix } from "./useRevenueMatrix";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Props = {
  products: ProductListItem[];
  /** Today's potential revenue per product (ordersSum × buyout%) — computed server-side. */
  revenueValues: Map<number, number>;
  /** Historical revenue matrix (ordersSum × buyout% per day) — computed server-side. */
  revenueMatrix: RevenueMatrix;
  onBack: () => void;
};

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day ?? ""}.${month ?? ""}.${year ?? ""}`;
}

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

export function DashboardRevenueDetailSection({
  products,
  revenueValues,
  revenueMatrix,
  onBack,
}: Props) {
  const today = todayIso();

  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colDate, setColDate] = useState(140);

  const matrixByNmId = useMemo(
    () => new Map(revenueMatrix.products.map((p) => [p.nmId, p.values])),
    [revenueMatrix.products],
  );

  const pastDates = useMemo(() => {
    const result: string[] = [];
    for (const d of revenueMatrix.dates) {
      if (d !== today) result.push(d);
    }
    return result;
  }, [revenueMatrix.dates, today]);

  // Totals: index 0 = today, index 1+ = pastDates[i-1]
  const dateTotals = useMemo(() => {
    const totals = new Array<number>(1 + pastDates.length).fill(0);
    for (const product of products) {
      if (product.nmId === null) continue;
      const v = revenueValues.get(product.nmId);
      if (v !== undefined) totals[0] += v;
    }
    const dateToTotalIdx = new Map<string, number>();
    pastDates.forEach((d, i) => dateToTotalIdx.set(d, i + 1));
    for (const row of revenueMatrix.products) {
      for (let i = 0; i < row.values.length; i++) {
        const v = row.values[i];
        if (v == null) continue;
        const d = revenueMatrix.dates[i];
        if (d == null || d === today) continue;
        const totalIdx = dateToTotalIdx.get(d);
        if (totalIdx != null) totals[totalIdx] += v;
      }
    }
    return totals;
  }, [pastDates, products, revenueValues, revenueMatrix.products, revenueMatrix.dates, today]);

  const matrixIdxByDate = useMemo(() => {
    const m = new Map<string, number>();
    revenueMatrix.dates.forEach((d, i) => m.set(d, i));
    return m;
  }, [revenueMatrix.dates]);

  const pinnedCol: DateColumn = useMemo(
    () => ({
      key: today,
      headerLabel: formatDate(today),
      totalDisplay: dateTotals[0] > 0 ? formatMoney(dateTotals[0]) : "—",
      accent: true,
    }),
    [today, dateTotals],
  );

  const dataCols: DateColumn[] = useMemo(
    () =>
      pastDates.map((d, i) => ({
        key: d,
        headerLabel: formatDate(d),
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
      const v = revenueValues.get(p.nmId);
      return moneyCell(v ?? null);
    },
    [products, revenueValues],
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
      title="Выручка"
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
