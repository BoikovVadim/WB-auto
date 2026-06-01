import { useCallback, useMemo, useState } from "react";

import type { TodayOrderCount } from "../../api/syncClientOrders";
import { formatMoney, formatDateWithWeekday } from "../../formatters";
import type { CpoMatrix } from "./useCpoMatrix";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Props = {
  products: ProductListItem[];
  /** Today's CPO per product (₽, (выручка / заказы) × ДРР%) — computed server-side. */
  cpoValues: Map<number, number>;
  /** Today's order counts per product — вес для взвешенного «Итого» за сегодня. */
  orderCounts: Map<number, TodayOrderCount>;
  /** Historical CPO matrix (cpo ₽, orders count per day) — computed server-side. */
  cpoMatrix: CpoMatrix;
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
  if (value == null) return EMPTY_CELL;
  return { display: formatMoney(value), copy: value.toFixed(2) };
}

export function DashboardCpoDetailSection({
  products,
  cpoValues,
  orderCounts,
  cpoMatrix,
  onBack,
}: Props) {
  const today = todayIso();

  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colDate, setColDate] = useState(140);

  const rowByNmId = useMemo(
    () => new Map(cpoMatrix.products.map((p) => [p.nmId, p])),
    [cpoMatrix.products],
  );

  const pastDates = useMemo(() => {
    const result: string[] = [];
    for (const d of cpoMatrix.dates) {
      if (d !== today) result.push(d);
    }
    return result;
  }, [cpoMatrix.dates, today]);

  const matrixIdxByDate = useMemo(() => {
    const m = new Map<string, number>();
    cpoMatrix.dates.forEach((d, i) => m.set(d, i));
    return m;
  }, [cpoMatrix.dates]);

  // «Итого» за сегодня — взвешенный CPO: Σ(cpo × заказы) / Σзаказы. Вес — кол-во заказов,
  // поэтому итог = средняя цена заказа × %выкупа × ДРР по магазину, а не среднее CPO строк.
  const todayTotalDisplay = useMemo(() => {
    let weighted = 0;
    let ordersSum = 0;
    for (const p of products) {
      if (p.nmId === null) continue;
      const cpo = cpoValues.get(p.nmId);
      const ord = orderCounts.get(p.nmId)?.ordersCount;
      if (cpo != null && ord != null && ord > 0) {
        weighted += cpo * ord;
        ordersSum += ord;
      }
    }
    return ordersSum > 0 ? formatMoney(weighted / ordersSum) : "—";
  }, [products, cpoValues, orderCounts]);

  // «Итого» по прошлым дням — взвешенный CPO за день: Σ(cpo×orders) / Σorders.
  const pastTotalsByDate = useMemo(() => {
    const totals = new Map<string, string>();
    for (const d of pastDates) {
      const idx = matrixIdxByDate.get(d);
      if (idx == null) {
        totals.set(d, "—");
        continue;
      }
      let weighted = 0;
      let ordersSum = 0;
      for (const row of cpoMatrix.products) {
        const cpo = row.cpo[idx];
        const ord = row.orders[idx];
        if (cpo != null && ord != null && ord > 0) {
          weighted += cpo * ord;
          ordersSum += ord;
        }
      }
      totals.set(d, ordersSum > 0 ? formatMoney(weighted / ordersSum) : "—");
    }
    return totals;
  }, [pastDates, matrixIdxByDate, cpoMatrix.products]);

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
      const v = cpoValues.get(p.nmId);
      return moneyCell(v ?? null);
    },
    [products, cpoValues],
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
      const v = row ? (row.cpo[idx] ?? null) : null;
      return moneyCell(v);
    },
    [products, pastDates, matrixIdxByDate, rowByNmId],
  );

  return (
    <VirtualMatrixTable
      title="CPO, ₽"
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
