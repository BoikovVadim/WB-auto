import { useCallback, useMemo, useState } from "react";
import { formatDateWithWeekday } from "../../formatters";

import type { TodayOrderCount } from "../../api/syncClientOrders";
import type { OrdersMatrix } from "./useOrdersMatrix";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Props = {
  products: ProductListItem[];
  /** Today's order counts — same data shown in the Products tab */
  orderCounts: Map<number, TodayOrderCount>;
  /** Historical orders matrix — preloaded at dashboard bootstrap */
  ordersMatrix: OrdersMatrix;
  onBack: () => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_CELL: CellContent = {
  display: <span style={{ opacity: 0.3 }}>—</span>,
  copy: "",
};

function numCell(value: number | null): CellContent {
  if (value == null) return EMPTY_CELL;
  return { display: String(value), copy: String(value) };
}

export function DashboardOrdersDetailSection({
  products,
  orderCounts,
  ordersMatrix,
  onBack,
}: Props) {
  const today = todayIso();

  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colDate, setColDate] = useState(130);

  const matrixByNmId = useMemo(
    () => new Map(ordersMatrix.products.map((p) => [p.nmId, p.values])),
    [ordersMatrix.products],
  );

  // Past dates only — "сегодня" is the pinned column, rendered separately
  const pastDates = useMemo(() => {
    const result: string[] = [];
    for (const d of ordersMatrix.dates) {
      if (d !== today) result.push(d);
    }
    return result;
  }, [ordersMatrix.dates, today]);

  // Totals: index 0 = today, index 1+ = pastDates[i-1]
  const dateTotals = useMemo(() => {
    const totals = new Array<number>(1 + pastDates.length).fill(0);
    for (const product of products) {
      if (product.nmId === null) continue;
      const oc = orderCounts.get(product.nmId);
      if (oc) totals[0] += oc.ordersCount;
    }
    // Matrix values are aligned to ordersMatrix.dates — same order as pastDates
    // (today excluded, since we filtered it).
    const dateToTotalIdx = new Map<string, number>();
    pastDates.forEach((d, i) => dateToTotalIdx.set(d, i + 1));
    for (const row of ordersMatrix.products) {
      for (let i = 0; i < row.values.length; i++) {
        const v = row.values[i];
        if (v == null) continue;
        const d = ordersMatrix.dates[i];
        if (d == null || d === today) continue;
        const totalIdx = dateToTotalIdx.get(d);
        if (totalIdx != null) totals[totalIdx] += v;
      }
    }
    return totals;
  }, [pastDates, products, orderCounts, ordersMatrix.products, ordersMatrix.dates, today]);

  // For each past date, find the index in ordersMatrix.dates so we can fetch values
  const matrixIdxByDate = useMemo(() => {
    const m = new Map<string, number>();
    ordersMatrix.dates.forEach((d, i) => m.set(d, i));
    return m;
  }, [ordersMatrix.dates]);

  const pinnedCol: DateColumn = useMemo(
    () => ({
      key: today,
      headerLabel: formatDateWithWeekday(today),
      totalDisplay: dateTotals[0] > 0 ? String(dateTotals[0]) : "—",
      accent: true,
    }),
    [today, dateTotals],
  );

  const dataCols: DateColumn[] = useMemo(
    () =>
      pastDates.map((d, i) => ({
        key: d,
        headerLabel: formatDateWithWeekday(d),
        totalDisplay: (dateTotals[i + 1] ?? 0) > 0 ? String(dateTotals[i + 1]) : "—",
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
      const oc = orderCounts.get(p.nmId);
      return numCell(oc ? oc.ordersCount : null);
    },
    [products, orderCounts],
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
      return numCell(v);
    },
    [products, pastDates, matrixIdxByDate, matrixByNmId],
  );

  return (
    <VirtualMatrixTable
      title="Заказы"
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
      dataColMinWidth={60}
      getCell={getCell}
      hasTotalsRow
    />
  );
}
