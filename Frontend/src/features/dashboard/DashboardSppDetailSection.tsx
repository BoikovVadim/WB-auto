import { useCallback, useMemo, useState } from "react";

import { formatPercent, formatDateWithWeekday } from "../../formatters";
import type { SppMatrix } from "./useSppMatrix";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Props = {
  products: ProductListItem[];
  /** Today's средняя СПП (%) per product — computed/stored server-side. */
  sppValues: Map<number, number>;
  /** Historical СПП matrix (закрытые дни) — computed server-side. */
  sppMatrix: SppMatrix;
  onBack: () => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_CELL: CellContent = {
  display: <span style={{ opacity: 0.3 }}>—</span>,
  copy: "",
};

// СПП = 0 — валидное значение (нет скидки в этот день), показываем «0,00 %»;
// «—» только при отсутствии данных (null/undefined).
function pctCell(value: number | null | undefined): CellContent {
  if (value == null) return EMPTY_CELL;
  return { display: formatPercent(value), copy: value.toFixed(2) };
}

export function DashboardSppDetailSection({
  products,
  sppValues,
  sppMatrix,
  onBack,
}: Props) {
  const today = todayIso();

  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colDate, setColDate] = useState(110);

  const matrixByNmId = useMemo(
    () => new Map(sppMatrix.products.map((p) => [p.nmId, p.values])),
    [sppMatrix.products],
  );

  const pastDates = useMemo(() => {
    const result: string[] = [];
    for (const d of sppMatrix.dates) {
      if (d !== today) result.push(d);
    }
    return result;
  }, [sppMatrix.dates, today]);

  // Тоталы — простое среднее СПП по товарам с данными. index 0 = today, 1+ = pastDates.
  const dateTotals = useMemo(() => {
    const n = 1 + pastDates.length;
    const sums = new Array<number>(n).fill(0);
    const counts = new Array<number>(n).fill(0);
    for (const product of products) {
      if (product.nmId === null) continue;
      const v = sppValues.get(product.nmId);
      if (v !== undefined) { sums[0] += v; counts[0] += 1; }
    }
    const dateToTotalIdx = new Map<string, number>();
    pastDates.forEach((d, i) => dateToTotalIdx.set(d, i + 1));
    for (const row of sppMatrix.products) {
      for (let i = 0; i < row.values.length; i++) {
        const v = row.values[i];
        if (v == null) continue;
        const d = sppMatrix.dates[i];
        if (d == null || d === today) continue;
        const totalIdx = dateToTotalIdx.get(d);
        if (totalIdx != null) { sums[totalIdx]! += v; counts[totalIdx]! += 1; }
      }
    }
    return sums.map((s, i) => (counts[i]! > 0 ? s / counts[i]! : null));
  }, [pastDates, products, sppValues, sppMatrix.products, sppMatrix.dates, today]);

  const matrixIdxByDate = useMemo(() => {
    const m = new Map<string, number>();
    sppMatrix.dates.forEach((d, i) => m.set(d, i));
    return m;
  }, [sppMatrix.dates]);

  const pinnedCol: DateColumn = useMemo(
    () => ({
      key: today,
      headerLabel: formatDateWithWeekday(today),
      totalDisplay: formatPercent(dateTotals[0] ?? null),
      accent: true,
    }),
    [today, dateTotals],
  );

  const dataCols: DateColumn[] = useMemo(
    () =>
      pastDates.map((d, i) => ({
        key: d,
        headerLabel: formatDateWithWeekday(d),
        totalDisplay: formatPercent(dateTotals[i + 1] ?? null),
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
      return pctCell(sppValues.get(p.nmId) ?? null);
    },
    [products, sppValues],
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
      return pctCell(v);
    },
    [products, pastDates, matrixIdxByDate, matrixByNmId],
  );

  return (
    <VirtualMatrixTable
      title="СПП"
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
