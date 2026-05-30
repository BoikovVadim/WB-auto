import { cloneElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { CostPriceCurrent } from "../../api/syncClientCostPrice";
import type { TodayOrderCount } from "../../api/syncClientOrders";
import type { TodayBuyoutCount } from "../../api/syncClientBuyouts";
import { formatMoney, formatPercent } from "../../formatters";
import type { CurrentPriceEntry } from "./useCurrentPrices";
import type { PriceChangeStatus } from "../../api/syncClientPrices";
import { ui } from "./copy";
import {
  loadScrollPosition,
  saveScrollPosition,
} from "./persistence/scrollPositionPersistence";
import type { ProductColumnDefinition, ProductsColumnKey } from "./productsTableColumns";
import { useProductsColumnOrderState } from "./useProductsColumnOrderState";
import type { ProductListItem, ProductListSortKey } from "./useDashboardProductsWorkspace";
import {
  CostInputCell,
  PriceConfirmModal,
  PriceInputCell,
  SortArrow,
} from "./ProductsTableCells";
import { getColLabel, getColWidth, getParentSortKey } from "./productsTableHelpers";

export type { CostPriceCurrent };
export type { CurrentPriceEntry };

const CATALOG_PRODUCTS_SCROLL_KEY = "catalog-products-list";

// Левые колонки, закреплённые при горизонтальном скролле (как №/ID/Название в
// ретроспективах). Закрепляем только ведущий непрерывный префикс из этого набора —
// если пользователь перетащит между ними обычную колонку, закрепление аккуратно
// прекратится, без визуальных нахлёстов.
const PINNED_COLUMN_KEYS: readonly ProductsColumnKey[] = ["index", "nmId", "vendorCode"];

type DashboardCatalogProductsSectionProps = {
  productCatalogCount: number;
  productsSearch: string;
  hasCatalogItems: boolean;
  isCatalogLoading: boolean;
  filteredProducts: ProductListItem[];
  productsSortKey: ProductListSortKey;
  productsSortDirection: "asc" | "desc";
  costPrices: Map<number, CostPriceCurrent>;
  orderCounts: Map<number, TodayOrderCount>;
  buyoutCounts: Map<number, TodayBuyoutCount>;
  rollingBuyoutCounts: Map<number, TodayBuyoutCount>;
  stockCounts: Map<number, number>;
  priceCounts: Map<number, CurrentPriceEntry>;
  ordersSumValues: Map<number, number>;
  revenueValues: Map<number, number>;
  costSumValues: Map<number, number>;
  adSpendValues: Map<number, number>;
  sppValues: Map<number, number>;
  priceChangeStatuses: Map<number, PriceChangeStatus>;
  /** Колонки, скрытые в этой секции. Напр. «Юнит Экономика» прячет
   *  заказы/остатки/сумму заказов/выручку/с-с продаж/рекламу. */
  hiddenColumns?: ProductsColumnKey[];
  onProductsSearchChange: (value: string) => void;
  onProductsSortToggle: (key: ProductListSortKey) => void;
  onOpenCostPriceSheet: () => void;
  onOpenOrdersSheet: () => void;
  onOpenBuyoutSheet: () => void;
  onOpenStocksSheet: () => void;
  onOpenPricesSheet: () => void;
  onOpenOrdersSumSheet: () => void;
  onOpenRevenueSheet: () => void;
  onOpenCostSumSheet: () => void;
  onOpenAdSpendSheet: () => void;
  onOpenSppSheet: () => void;
  onCostSaved: (nmId: number, value: number) => Promise<void>;
  onCostCleared: (nmIds: number[]) => Promise<void>;
  /** ⚠️ Запись новой цены «со скидкой» на маркетплейс WB. */
  onPriceSaved: (nmId: number, targetFinal: number) => Promise<void>;
};

// ─── Local sort key (for columns backed by external Maps) ────────────────────
type LocalSortKey = "cost" | "price" | "orders" | "buyout" | "spp" | "stock" | "ordersSum" | "revenue" | "costSum" | "adSpend";

// ─── Main component ───────────────────────────────────────────────────────────

export const DashboardCatalogProductsSection = memo(
  function DashboardCatalogProductsSection(props: DashboardCatalogProductsSectionProps) {
    const tableWrapRef = useRef<HTMLDivElement | null>(null);
    const tableRef = useRef<HTMLTableElement | null>(null);
    const resizingColRef = useRef<number | null>(null);

    // ── Column ordering (drag-and-drop) ────────────────────────────────────────
    const { draggedColumn, orderedColumns: allOrderedColumns, setDraggedColumn, handleDrop } =
      useProductsColumnOrderState();
    // Скрытые в этой секции колонки (порядок/ширины храним общими, фильтруем только показ).
    const hiddenColumns = props.hiddenColumns;
    const orderedColumns = useMemo(
      () =>
        hiddenColumns && hiddenColumns.length > 0
          ? allOrderedColumns.filter((c) => !hiddenColumns.includes(c.key))
          : allOrderedColumns,
      [allOrderedColumns, hiddenColumns],
    );

    // ── Multi-select state ──────────────────────────────────────────────────────
    const [selectedNmIds, setSelectedNmIds] = useState<Set<number>>(new Set());
    const [editingNmId, setEditingNmId] = useState<number | null>(null);
    const [editingPriceNmId, setEditingPriceNmId] = useState<number | null>(null);
    const lastClickedIndexRef = useRef<number>(-1);

    // ── Local sort (for cost/orders/stock columns) ──────────────────────────────
    const [localSortKey, setLocalSortKey] = useState<LocalSortKey | null>(null);
    const [localSortDir, setLocalSortDir] = useState<"asc" | "desc">("desc");

    // Reset local sort when parent sort changes
    const prevParentSortKey = useRef(props.productsSortKey);
    useEffect(() => {
      if (props.productsSortKey !== prevParentSortKey.current) {
        prevParentSortKey.current = props.productsSortKey;
        setLocalSortKey(null);
      }
    }, [props.productsSortKey]);

    const handleLocalSortToggle = useCallback((key: LocalSortKey) => {
      setLocalSortKey((prev) => {
        if (prev === key) {
          setLocalSortDir((d) => (d === "asc" ? "desc" : "asc"));
          return key;
        }
        setLocalSortDir("desc");
        return key;
      });
    }, []);

    const handleParentSortToggle = useCallback(
      (key: ProductListSortKey) => {
        setLocalSortKey(null);
        props.onProductsSortToggle(key);
      },
      [props],
    );

    // Products sorted by local sort (if active), otherwise use parent-sorted list
    const displayProducts = useMemo(() => {
      if (!localSortKey) return props.filteredProducts;
      return [...props.filteredProducts].sort((a, b) => {
        let av = 0;
        let bv = 0;
        if (localSortKey === "orders") {
          av = a.nmId !== null ? (props.orderCounts.get(a.nmId)?.ordersCount ?? 0) : 0;
          bv = b.nmId !== null ? (props.orderCounts.get(b.nmId)?.ordersCount ?? 0) : 0;
        } else if (localSortKey === "buyout") {
          const buyoutPercent = (nmId: number | null): number => {
            if (nmId === null) return -1;
            const entry = props.rollingBuyoutCounts.get(nmId);
            // 0 выкупов при наличии заказов = данных ещё нет (WB отдаёт выкупы с
            // лагом), а не реальный 0 % — сортируем как «нет данных», см. ретроспективу.
            if (!entry || entry.ordersCount === 0 || entry.buyoutsCount === 0) return -1;
            return (entry.buyoutsCount / entry.ordersCount) * 100;
          };
          av = buyoutPercent(a.nmId);
          bv = buyoutPercent(b.nmId);
        } else if (localSortKey === "stock") {
          av = a.nmId !== null ? (props.stockCounts.get(a.nmId) ?? 0) : 0;
          bv = b.nmId !== null ? (props.stockCounts.get(b.nmId) ?? 0) : 0;
        } else if (localSortKey === "ordersSum") {
          av = a.nmId !== null ? (props.ordersSumValues.get(a.nmId) ?? 0) : 0;
          bv = b.nmId !== null ? (props.ordersSumValues.get(b.nmId) ?? 0) : 0;
        } else if (localSortKey === "revenue") {
          av = a.nmId !== null ? (props.revenueValues.get(a.nmId) ?? 0) : 0;
          bv = b.nmId !== null ? (props.revenueValues.get(b.nmId) ?? 0) : 0;
        } else if (localSortKey === "costSum") {
          av = a.nmId !== null ? (props.costSumValues.get(a.nmId) ?? 0) : 0;
          bv = b.nmId !== null ? (props.costSumValues.get(b.nmId) ?? 0) : 0;
        } else if (localSortKey === "adSpend") {
          av = a.nmId !== null ? (props.adSpendValues.get(a.nmId) ?? 0) : 0;
          bv = b.nmId !== null ? (props.adSpendValues.get(b.nmId) ?? 0) : 0;
        } else if (localSortKey === "spp") {
          av = a.nmId !== null ? (props.sppValues.get(a.nmId) ?? -1) : -1;
          bv = b.nmId !== null ? (props.sppValues.get(b.nmId) ?? -1) : -1;
        } else if (localSortKey === "price") {
          av = a.nmId !== null ? (props.priceCounts.get(a.nmId)?.priceWithDiscount ?? 0) : 0;
          bv = b.nmId !== null ? (props.priceCounts.get(b.nmId)?.priceWithDiscount ?? 0) : 0;
        } else {
          // cost
          av = a.nmId !== null ? (props.costPrices.get(a.nmId)?.costValue ?? 0) : 0;
          bv = b.nmId !== null ? (props.costPrices.get(b.nmId)?.costValue ?? 0) : 0;
        }
        return localSortDir === "asc" ? av - bv : bv - av;
      });
    }, [props.filteredProducts, localSortKey, localSortDir, props.orderCounts, props.rollingBuyoutCounts, props.stockCounts, props.ordersSumValues, props.revenueValues, props.costSumValues, props.adSpendValues, props.sppValues, props.costPrices, props.priceCounts]);

    const handleCommitEdit = useCallback(() => {
      setEditingNmId(null);
    }, []);

    // Стабильный колбэк для карандаша: сбрасываем выделение и входим в редактирование
    // конкретной строки. Один и тот же reference на все ячейки — memo не ломается.
    const handleStartEdit = useCallback((nmId: number) => {
      setSelectedNmIds(new Set());
      setEditingPriceNmId(null);
      setEditingNmId(nmId);
    }, []);

    // Редактирование цены (отправка на WB) — отдельно от себестоимости.
    const handleStartPriceEdit = useCallback((nmId: number) => {
      setSelectedNmIds(new Set());
      setEditingNmId(null);
      setEditingPriceNmId(nmId);
    }, []);
    const handleCommitPriceEdit = useCallback(() => {
      setEditingPriceNmId(null);
    }, []);

    // Модалка подтверждения цены: открывается после Enter в поле.
    const [priceConfirm, setPriceConfirm] = useState<{ nmId: number; target: number } | null>(null);
    const handleRequestPriceConfirm = useCallback((nmId: number, target: number) => {
      setEditingPriceNmId(null);
      setPriceConfirm({ nmId, target });
    }, []);
    const handleCancelPriceConfirm = useCallback(() => setPriceConfirm(null), []);
    const handleConfirmPrice = useCallback(async () => {
      if (!priceConfirm) return;
      const { nmId, target } = priceConfirm;
      setPriceConfirm(null);
      await props.onPriceSaved(nmId, target);
    }, [priceConfirm, props]);

    const handleCellClick = useCallback(
      (nmId: number, index: number, event: React.MouseEvent) => {
        if ((event.target as HTMLElement).tagName === "INPUT") return;

        if (event.ctrlKey || event.metaKey) {
          setSelectedNmIds((prev) => {
            const next = new Set(prev);
            if (next.has(nmId)) next.delete(nmId);
            else next.add(nmId);
            return next;
          });
          lastClickedIndexRef.current = index;
          setEditingNmId(null);
        } else if (event.shiftKey && lastClickedIndexRef.current >= 0) {
          const from = Math.min(lastClickedIndexRef.current, index);
          const to = Math.max(lastClickedIndexRef.current, index);
          setSelectedNmIds(() => {
            const next = new Set<number>();
            for (let i = from; i <= to; i++) {
              const p = displayProducts[i];
              if (p?.nmId !== null && p?.nmId !== undefined) next.add(p.nmId);
            }
            return next;
          });
          setEditingNmId(null);
        } else if (selectedNmIds.size > 0) {
          setSelectedNmIds(new Set([nmId]));
          lastClickedIndexRef.current = index;
          setEditingNmId(null);
        } else {
          setSelectedNmIds(new Set());
          lastClickedIndexRef.current = index;
          setEditingNmId(nmId);
        }
      },
      [selectedNmIds, displayProducts],
    );

    const handleCellDoubleClick = useCallback((nmId: number, index: number) => {
      setSelectedNmIds(new Set());
      lastClickedIndexRef.current = index;
      setEditingNmId(nmId);
    }, []);

    // ── Keyboard handler ────────────────────────────────────────────────────────
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement
        ) return;

        if ((e.key === "Delete" || e.key === "Backspace") && selectedNmIds.size > 0) {
          e.preventDefault();
          const ids = Array.from(selectedNmIds);
          void props.onCostCleared(ids).then(() => {
            setSelectedNmIds(new Set());
          });
        } else if (e.key === "Escape") {
          setSelectedNmIds(new Set());
          setEditingNmId(null);
          setEditingPriceNmId(null);
        } else if (e.key === "Enter" && selectedNmIds.size === 1) {
          const [id] = selectedNmIds;
          if (id !== undefined) {
            setSelectedNmIds(new Set());
            setEditingNmId(id);
          }
        }
      };
      document.addEventListener("keydown", handler);
      return () => document.removeEventListener("keydown", handler);
    }, [selectedNmIds, props.onCostCleared]);

    // Click outside clears selection
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (tableRef.current && !tableRef.current.contains(e.target as Node)) {
          setSelectedNmIds(new Set());
          setEditingNmId(null);
          setEditingPriceNmId(null);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, []);

    const getDisplayVendorCode = (p: { vendorCode: string; nmId: number | null }) =>
      p.vendorCode !== "" ? p.vendorCode : p.nmId !== null ? `#${String(p.nmId)}` : "—";

    const widestVendorCode = useMemo(
      () =>
        props.filteredProducts.reduce((max, p) => {
          const display = getDisplayVendorCode(p);
          return display.length > max.length ? display : max;
        }, ""),
      [props.filteredProducts],
    );

    const nameColWidth = useMemo(() => {
      const MIN_WIDTH = 130;
      if (!widestVendorCode) return MIN_WIDTH;
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return Math.max(widestVendorCode.length * 9 + 22, MIN_WIDTH);
        ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
        return Math.max(Math.ceil(ctx.measureText(widestVendorCode).width) + 22, MIN_WIDTH);
      } catch {
        return Math.max(widestVendorCode.length * 9 + 22, MIN_WIDTH);
      }
    }, [widestVendorCode]);

    const totalW = useMemo(
      () => orderedColumns.reduce((sum, col) => sum + getColWidth(col, nameColWidth), 0),
      [orderedColumns, nameColWidth],
    );

    // ── Закрепление левых колонок (sticky) ───────────────────────────────────────
    // Считаем left-офсет для каждой закреплённой колонки из ведущего префикса
    // PINNED_COLUMN_KEYS; lastPinnedKey — для разделительной тени справа.
    const { pinnedLeftByKey, lastPinnedKey } = useMemo(() => {
      const map = new Map<ProductsColumnKey, number>();
      let left = 0;
      let last: ProductsColumnKey | null = null;
      for (const col of orderedColumns) {
        if (!PINNED_COLUMN_KEYS.includes(col.key)) break;
        map.set(col.key, left);
        left += getColWidth(col, nameColWidth);
        last = col.key;
      }
      return { pinnedLeftByKey: map, lastPinnedKey: last };
    }, [orderedColumns, nameColWidth]);

    // Применяет sticky-класс + left-офсет к уже отрендеренной ячейке колонки (th/td),
    // не трогая switch'и рендереров. Фоны закреплённых ячеек задаёт класс
    // .wb-table-cell--sticky-left (header/totals/body — каждый со своим фоном).
    const withPin = useCallback(
      (
        col: ProductColumnDefinition,
        el: ReactElement<{ className?: string; style?: React.CSSProperties }> | undefined,
      ) => {
        if (!el) return el;
        const left = pinnedLeftByKey.get(col.key);
        if (left === undefined) return el;
        const className = [
          el.props.className,
          "wb-table-cell--sticky-left",
          col.key === lastPinnedKey ? "wb-table-cell--sticky-left-last" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return cloneElement(el, { className, style: { ...el.props.style, left } });
      },
      [pinnedLeftByKey, lastPinnedKey],
    );

    // ── Column resizing ─────────────────────────────────────────────────────────
    const handleResizeMouseDown = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!tableRef.current) return;
        const colIndex = Number((event.currentTarget as HTMLElement).dataset.colIdx ?? "-1");
        if (!Number.isFinite(colIndex) || colIndex < 0) return;
        const tableEl = tableRef.current;
        const cols = tableEl.querySelectorAll<HTMLTableColElement>("colgroup col");
        if (!cols[colIndex]) return;

        const measuredColWidths = Array.from(cols).map((col) => {
          const measured = col.getBoundingClientRect().width;
          if (measured > 0) return measured;
          const parsed = Number.parseFloat(col.style.width);
          return Number.isFinite(parsed) ? parsed : 0;
        });
        const initialSelectedWidth = measuredColWidths[colIndex] ?? 0;
        const startX = event.clientX;
        resizingColRef.current = colIndex;
        document.body.style.cursor = "col-resize";

        const onMouseMove = (moveEvent: MouseEvent) => {
          if (resizingColRef.current === null || !tableRef.current) return;
          const minWidth = 60;
          const delta = moveEvent.clientX - startX;
          const newWidth = Math.max(minWidth, initialSelectedWidth + delta);
          const col = cols[resizingColRef.current];
          if (col) col.style.width = `${newWidth}px`;
          const totalTableWidth = measuredColWidths.reduce(
            (sum, w, i) => sum + (i === resizingColRef.current ? newWidth : w),
            0,
          );
          tableEl.style.width = `${Math.ceil(totalTableWidth)}px`;
        };

        const onMouseUp = () => {
          resizingColRef.current = null;
          document.body.style.cursor = "";
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp, { once: true });
      },
      [],
    );

    useLayoutEffect(() => {
      const el = tableWrapRef.current;
      if (!el) return;
      const target = loadScrollPosition(CATALOG_PRODUCTS_SCROLL_KEY);
      if (target > 0) el.scrollTop = target;
    }, [props.hasCatalogItems]);

    // ── Виртуализация строк ──────────────────────────────────────────────────────
    // Рендерим только видимые строки (тот же приём, что в ретроспективах), НЕ трогая
    // разметку ячеек, редактирование себестоимости, drag-reorder, выделение и
    // сортировки — поэтому регрессий нет, а скролл/сортировка/поиск становятся
    // мгновенными при сотнях товаров. Высоту строк измеряем динамически
    // (measureElement), чтобы скролл не «уплывал».
    const rowVirtualizer = useVirtualizer({
      count: displayProducts.length,
      getScrollElement: () => tableWrapRef.current,
      estimateSize: () => 26,
      overscan: 14,
    });
    const virtualRows = rowVirtualizer.getVirtualItems();
    const virtualTotalSize = rowVirtualizer.getTotalSize();
    const padTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
    const padBottom =
      virtualRows.length > 0
        ? virtualTotalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
        : 0;

    const { productsSortKey: sortKey, productsSortDirection: sortDir } = props;

    const totalOrders = useMemo(
      () =>
        props.filteredProducts.reduce((sum, p) => {
          if (p.nmId === null) return sum;
          return sum + (props.orderCounts.get(p.nmId)?.ordersCount ?? 0);
        }, 0),
      [props.filteredProducts, props.orderCounts],
    );

    const totalStocks = useMemo(() => {
      let sum = 0;
      let hasAny = false;
      for (const p of props.filteredProducts) {
        if (p.nmId === null) continue;
        const s = props.stockCounts.get(p.nmId);
        if (s !== undefined) { sum += s; hasAny = true; }
      }
      return hasAny ? sum : null;
    }, [props.filteredProducts, props.stockCounts]);

    const totalOrdersSum = useMemo(() => {
      let sum = 0;
      let hasAny = false;
      for (const p of props.filteredProducts) {
        if (p.nmId === null) continue;
        const v = props.ordersSumValues.get(p.nmId);
        if (v !== undefined && v > 0) { sum += v; hasAny = true; }
      }
      return hasAny ? sum : null;
    }, [props.filteredProducts, props.ordersSumValues]);

    const totalBuyoutPercent = useMemo(() => {
      let orders  = 0;
      let buyouts = 0;
      for (const p of props.filteredProducts) {
        if (p.nmId === null) continue;
        const e = props.rollingBuyoutCounts.get(p.nmId);
        // Те же товары, что и в отображении: 0 выкупов = «нет данных» (—) и в
        // «Итого» не участвуют. Иначе их заказы тянули бы знаменатель вниз и
        // итог расходился бы с ретроспективой за «сегодня».
        if (!e || e.ordersCount === 0 || e.buyoutsCount === 0) continue;
        orders  += e.ordersCount;
        buyouts += e.buyoutsCount;
      }
      return orders > 0 ? (buyouts / orders) * 100 : null;
    }, [props.filteredProducts, props.rollingBuyoutCounts]);

    const totalRevenue = useMemo(() => {
      let sum = 0;
      let hasAny = false;
      for (const p of props.filteredProducts) {
        if (p.nmId === null) continue;
        const v = props.revenueValues.get(p.nmId);
        if (v !== undefined && v > 0) { sum += v; hasAny = true; }
      }
      return hasAny ? sum : null;
    }, [props.filteredProducts, props.revenueValues]);

    const totalCostSum = useMemo(() => {
      let sum = 0;
      let hasAny = false;
      for (const p of props.filteredProducts) {
        if (p.nmId === null) continue;
        const v = props.costSumValues.get(p.nmId);
        if (v !== undefined && v > 0) { sum += v; hasAny = true; }
      }
      return hasAny ? sum : null;
    }, [props.filteredProducts, props.costSumValues]);

    const totalAdSpend = useMemo(() => {
      let sum = 0;
      let hasAny = false;
      for (const p of props.filteredProducts) {
        if (p.nmId === null) continue;
        const v = props.adSpendValues.get(p.nmId);
        if (v !== undefined && v > 0) { sum += v; hasAny = true; }
      }
      return hasAny ? sum : null;
    }, [props.filteredProducts, props.adSpendValues]);

    // СПП «Итого» — простое среднее по товарам с данными (то же усреднение, что у
    // самой метрики). spp=0 — валидное значение, учитывается; «—» только без данных.
    const totalSpp = useMemo(() => {
      let sum = 0;
      let count = 0;
      for (const p of props.filteredProducts) {
        if (p.nmId === null) continue;
        const v = props.sppValues.get(p.nmId);
        if (v !== undefined) { sum += v; count += 1; }
      }
      return count > 0 ? sum / count : null;
    }, [props.filteredProducts, props.sppValues]);

    // ── Header cell renderer ───────────────────────────────────────────────────

    const renderHeaderCell = (col: ProductColumnDefinition, colIdx: number) => {
      const key = col.key;
      const parentSortKey = getParentSortKey(key);
      const isParentActive = localSortKey === null && parentSortKey !== null && sortKey === parentSortKey;
      const isLocalActive = localSortKey === key;
      const isResizable = key === "vendorCode" || key === "category" || key === "subject";
      const isNumeric = key === "index" || key === "nmId" || key === "cost" || key === "price" || key === "orders" || key === "buyout" || key === "spp" || key === "stock" || key === "ordersSum" || key === "revenue" || key === "costSum" || key === "adSpend";
      const isDragging = draggedColumn === key;

      const dragHandlers = {
        draggable: true as const,
        onDragStart: (e: React.DragEvent<HTMLTableCellElement>) => {
          if ((e.target as HTMLElement).closest(".wb-col-resize-handle")) {
            e.preventDefault();
            return;
          }
          setDraggedColumn(key);
        },
        onDragEnd: () => setDraggedColumn(null),
        onDragOver: (e: React.DragEvent<HTMLTableCellElement>) => e.preventDefault(),
        onDrop: (e: React.DragEvent<HTMLTableCellElement>) => handleDrop(e, key),
      };

      const thStyle: React.CSSProperties = {};
      if (isNumeric) thStyle.textAlign = "right";

      // Заголовок столбца с ретроспективой: клик по НАЗВАНИЮ открывает лист
      // ретроспективы, клик по СТРЕЛКЕ справа — сортирует. (Раньше было наоборот:
      // название сортировало, а отдельная «↗» открывала лист.)
      const renderSheetHeader = (
        label: string,
        localKey: LocalSortKey,
        onOpenSheet: () => void,
        sheetTitle: string,
      ) => (
        <div className="wb-products-col-header-split">
          <button
            className="wb-products-header-sheet-btn"
            type="button"
            title={sheetTitle}
            onClick={onOpenSheet}
          >
            <span>{label}</span>
          </button>
          <button
            className="wb-products-header-sort-btn"
            type="button"
            title="Сортировать"
            onClick={() => handleLocalSortToggle(localKey)}
          >
            <SortArrow active={isLocalActive} direction={localSortDir} />
          </button>
        </div>
      );

      const content = (() => {
        switch (key) {
          case "index":
          case "nmId":
            return (
              <button
                className="wb-products-sort-button"
                type="button"
                onClick={() => handleParentSortToggle("id")}
              >
                <span>{getColLabel(key)}</span>
                <SortArrow active={isParentActive} direction={sortDir} />
              </button>
            );
          case "vendorCode":
            return (
              <>
                <button
                  className="wb-products-sort-button"
                  type="button"
                  onClick={() => handleParentSortToggle("name")}
                >
                  <span>{getColLabel(key)}</span>
                  <SortArrow active={isParentActive} direction={sortDir} />
                </button>
                <div className="wb-col-resize-handle" data-col-idx={String(colIdx)} onMouseDown={handleResizeMouseDown} />
              </>
            );
          case "category":
            return (
              <>
                <button
                  className="wb-products-sort-button"
                  type="button"
                  onClick={() => handleParentSortToggle("category")}
                >
                  <span>{getColLabel(key)}</span>
                  <SortArrow active={isParentActive} direction={sortDir} />
                </button>
                <div className="wb-col-resize-handle" data-col-idx={String(colIdx)} onMouseDown={handleResizeMouseDown} />
              </>
            );
          case "subject":
            return (
              <>
                <button
                  className="wb-products-sort-button"
                  type="button"
                  onClick={() => handleParentSortToggle("subject")}
                >
                  <span>{getColLabel(key)}</span>
                  <SortArrow active={isParentActive} direction={sortDir} />
                </button>
                <div className="wb-col-resize-handle" data-col-idx={String(colIdx)} onMouseDown={handleResizeMouseDown} />
              </>
            );
          case "cost":
            return renderSheetHeader("Себестоимость", "cost", props.onOpenCostPriceSheet, "Открыть лист себестоимости");
          case "price":
            return renderSheetHeader("Цена", "price", props.onOpenPricesSheet, "Открыть ретроспективу цен");
          case "orders":
            return renderSheetHeader("Заказы", "orders", props.onOpenOrdersSheet, "Открыть ретроспективу заказов");
          case "buyout":
            return renderSheetHeader("% выкупа", "buyout", props.onOpenBuyoutSheet, "Открыть ретроспективу % выкупа");
          case "spp":
            return renderSheetHeader("СПП", "spp", props.onOpenSppSheet, "Открыть ретроспективу СПП");
          case "stock":
            return renderSheetHeader("Остатки", "stock", props.onOpenStocksSheet, "Открыть ретроспективу остатков");
          case "ordersSum":
            return renderSheetHeader("Сумма заказов", "ordersSum", props.onOpenOrdersSumSheet, "Открыть ретроспективу суммы заказов");
          case "revenue":
            return renderSheetHeader("Выручка", "revenue", props.onOpenRevenueSheet, "Открыть ретроспективу выручки");
          case "costSum":
            return renderSheetHeader("С/с продаж", "costSum", props.onOpenCostSumSheet, "Открыть ретроспективу С/с продаж");
          case "adSpend":
            return renderSheetHeader("Реклама", "adSpend", props.onOpenAdSpendSheet, "Открыть ретроспективу расходов на рекламу");
        }
      })();

      return (
        <th
          key={key}
          className={isDragging ? "wb-products-column--dragging" : undefined}
          style={thStyle}
          {...dragHandlers}
        >
          {content}
        </th>
      );
    };

    // ── Totals row cell renderer ──────────────────────────────────────────────

    const renderTotalsCell = (col: ProductColumnDefinition) => {
      const key = col.key;
      switch (key) {
        case "vendorCode":
          return (
            <th
              key={key}
              style={{ textAlign: "left", fontWeight: 700, color: "rgba(15,23,42,0.45)" }}
            >
              Итого
            </th>
          );
        case "orders":
          return (
            <th key={key} className="wb-table-cell--numeric">
              {totalOrders > 0 ? String(totalOrders) : "—"}
            </th>
          );
        case "buyout":
          return (
            <th key={key} className="wb-table-cell--numeric">
              {formatPercent(totalBuyoutPercent)}
            </th>
          );
        case "spp":
          return (
            <th key={key} className="wb-table-cell--numeric">
              {formatPercent(totalSpp)}
            </th>
          );
        case "stock":
          return (
            <th key={key} className="wb-table-cell--numeric">
              {totalStocks !== null ? String(totalStocks) : "—"}
            </th>
          );
        case "ordersSum":
          return (
            <th key={key} className="wb-table-cell--numeric">
              {totalOrdersSum !== null ? formatMoney(totalOrdersSum) : "—"}
            </th>
          );
        case "revenue":
          return (
            <th key={key} className="wb-table-cell--numeric">
              {totalRevenue !== null ? formatMoney(totalRevenue) : "—"}
            </th>
          );
        case "costSum":
          return (
            <th key={key} className="wb-table-cell--numeric">
              {totalCostSum !== null ? formatMoney(totalCostSum) : "—"}
            </th>
          );
        case "adSpend":
          return (
            <th key={key} className="wb-table-cell--numeric">
              {totalAdSpend !== null ? formatMoney(totalAdSpend) : "—"}
            </th>
          );
        default:
          return <th key={key} />;
      }
    };

    // ── Body cell renderer ────────────────────────────────────────────────────

    const renderBodyCell = (
      col: ProductColumnDefinition,
      product: ProductListItem,
      index: number,
    ) => {
      const key = col.key;
      const nmId = product.nmId;
      const cost = nmId !== null ? props.costPrices.get(nmId) : undefined;
      const orders = nmId !== null ? props.orderCounts.get(nmId) : undefined;
      const buyout = nmId !== null ? props.rollingBuyoutCounts.get(nmId) : undefined;
      const stock = nmId !== null ? props.stockCounts.get(nmId) : undefined;
      const priceEntry = nmId !== null ? props.priceCounts.get(nmId) : undefined;
      const ordersSum = nmId !== null ? props.ordersSumValues.get(nmId) : undefined;
      const isSelected = nmId !== null && selectedNmIds.has(nmId);
      const isEditing = nmId !== null && editingNmId === nmId;

      switch (key) {
        case "index":
          return (
            <td key={key} className="wb-table-cell--numeric">
              {String(index + 1)}
            </td>
          );
        case "nmId":
          return (
            <td key={key} className="wb-table-cell--numeric">
              {nmId === null ? "—" : String(nmId)}
            </td>
          );
        case "vendorCode":
          return (
            <td key={key}>
              <span
                title={getDisplayVendorCode(product)}
                style={{
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {getDisplayVendorCode(product)}
              </span>
            </td>
          );
        case "category":
          return <td key={key}>{product.categoryName ?? "—"}</td>;
        case "subject":
          return <td key={key}>{product.subjectName ?? "—"}</td>;
        case "cost":
          return (
            <td
              key={key}
              className={`wb-table-cell--cost${isSelected ? " wb-table-cell--cost-selected" : ""}`}
              onClick={nmId !== null ? (e) => handleCellClick(nmId, index, e) : undefined}
              onDoubleClick={nmId !== null ? () => handleCellDoubleClick(nmId, index) : undefined}
            >
              {nmId !== null ? (
                <CostInputCell
                  nmId={nmId}
                  savedValue={cost?.costValue ?? null}
                  isSelected={isSelected}
                  isEditing={isEditing}
                  onSaved={props.onCostSaved}
                  onCommitEdit={handleCommitEdit}
                  onStartEdit={handleStartEdit}
                />
              ) : "—"}
            </td>
          );
        case "price":
          return (
            <td key={key} className="wb-table-cell--numeric wb-table-cell--cost">
              {nmId !== null ? (
                <PriceInputCell
                  nmId={nmId}
                  entry={priceEntry}
                  overlay={props.priceChangeStatuses.get(nmId)}
                  isEditing={editingPriceNmId === nmId}
                  onStartEdit={handleStartPriceEdit}
                  onCommitEdit={handleCommitPriceEdit}
                  onRequestConfirm={handleRequestPriceConfirm}
                />
              ) : (
                <span style={{ opacity: 0.3 }}>—</span>
              )}
            </td>
          );
        case "orders":
          return (
            <td key={key} className="wb-table-cell--numeric wb-table-cell--orders">
              {orders && orders.ordersCount > 0 ? String(orders.ordersCount) : "—"}
            </td>
          );
        case "buyout": {
          // 0 выкупов при наличии заказов = данных ещё нет → «—», как в ретроспективе
          // (не фантомные 0,00 %). Процент показываем только когда есть и заказы, и выкупы.
          const hasData = !!buyout && buyout.ordersCount > 0 && buyout.buyoutsCount > 0;
          const percent = hasData ? (buyout.buyoutsCount / buyout.ordersCount) * 100 : null;
          return (
            <td key={key} className="wb-table-cell--numeric">
              {percent !== null
                ? formatPercent(percent)
                : <span style={{ opacity: 0.3 }}>—</span>}
            </td>
          );
        }
        case "spp": {
          // СПП за сегодня (среднее по заказам). spp=0 — валидное значение (нет скидки),
          // показываем «0,00 %»; «—» только при отсутствии данных (нет заказов сегодня).
          const spp = nmId !== null ? props.sppValues.get(nmId) : undefined;
          return (
            <td key={key} className="wb-table-cell--numeric">
              {spp !== undefined
                ? formatPercent(spp)
                : <span style={{ opacity: 0.3 }}>—</span>}
            </td>
          );
        }
        case "stock":
          return (
            <td key={key} className="wb-table-cell--numeric">
              {stock !== undefined ? String(stock) : "—"}
            </td>
          );
        case "ordersSum":
          return (
            <td key={key} className="wb-table-cell--numeric">
              {ordersSum !== undefined && ordersSum > 0
                ? formatMoney(ordersSum)
                : <span style={{ opacity: 0.3 }}>—</span>}
            </td>
          );
        case "revenue": {
          const revenue = nmId !== null ? props.revenueValues.get(nmId) : undefined;
          return (
            <td key={key} className="wb-table-cell--numeric">
              {revenue !== undefined && revenue > 0
                ? formatMoney(revenue)
                : <span style={{ opacity: 0.3 }}>—</span>}
            </td>
          );
        }
        case "costSum": {
          const costSum = nmId !== null ? props.costSumValues.get(nmId) : undefined;
          return (
            <td key={key} className="wb-table-cell--numeric">
              {costSum !== undefined && costSum > 0
                ? formatMoney(costSum)
                : <span style={{ opacity: 0.3 }}>—</span>}
            </td>
          );
        }
        case "adSpend": {
          const adSpend = nmId !== null ? props.adSpendValues.get(nmId) : undefined;
          return (
            <td key={key} className="wb-table-cell--numeric">
              {adSpend !== undefined && adSpend > 0
                ? formatMoney(adSpend)
                : <span style={{ opacity: 0.3 }}>—</span>}
            </td>
          );
        }
      }
    };

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
      <section className="wb-card wb-card--wide">
        <div className="wb-workspace-header wb-workspace-header--products-list">
          <h2 className="wb-products-list-title">{`${ui.viewCatalogProducts} — ${props.productCatalogCount}`}</h2>
          <div className="wb-products-toolbar">
            <input
              className="wb-input wb-products-search"
              type="search"
              value={props.productsSearch}
              onChange={(e) => props.onProductsSearchChange(e.target.value)}
              placeholder={ui.productsSearchPlaceholder}
            />
          </div>
        </div>

        {props.hasCatalogItems ? (
          <div className="wb-products-page">
            <section className="wb-table-section">
              <div
                ref={tableWrapRef}
                className="wb-table-wrap--catalog-restricted"
                onScroll={(e) => {
                  saveScrollPosition(CATALOG_PRODUCTS_SCROLL_KEY, e.currentTarget.scrollTop);
                }}
              >
                <table
                  ref={tableRef}
                  className="wb-data-table wb-data-table--products"
                  style={{ tableLayout: "fixed", width: `${String(totalW)}px` }}
                >
                  <colgroup>
                    {orderedColumns.map((col) => (
                      <col
                        key={col.key}
                        style={{ width: `${String(getColWidth(col, nameColWidth))}px` }}
                      />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      {orderedColumns.map((col, colIdx) => withPin(col, renderHeaderCell(col, colIdx)))}
                    </tr>
                    {displayProducts.length > 0 && (
                      <tr className="wb-products-totals-row wb-thead-row--second">
                        {orderedColumns.map((col) => withPin(col, renderTotalsCell(col)))}
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {displayProducts.length > 0 ? (
                      <>
                        {padTop > 0 && (
                          <tr aria-hidden>
                            <td colSpan={orderedColumns.length} style={{ height: padTop, padding: 0, border: 0 }} />
                          </tr>
                        )}
                        {virtualRows.map((vRow) => {
                          const product = displayProducts[vRow.index];
                          if (!product) return null;
                          return (
                            <tr
                              key={`${product.vendorCode}-${product.nmId ?? "none"}`}
                              data-index={vRow.index}
                              ref={rowVirtualizer.measureElement}
                            >
                              {orderedColumns.map((col) => withPin(col, renderBodyCell(col, product, vRow.index)))}
                            </tr>
                          );
                        })}
                        {padBottom > 0 && (
                          <tr aria-hidden>
                            <td colSpan={orderedColumns.length} style={{ height: padBottom, padding: 0, border: 0 }} />
                          </tr>
                        )}
                      </>
                    ) : (
                      <tr>
                        <td colSpan={orderedColumns.length}>{ui.noProductsFound}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : props.isCatalogLoading ? null : (
          <p className="wb-empty-copy">{ui.productsEmpty}</p>
        )}

        {priceConfirm && (() => {
          const e = props.priceCounts.get(priceConfirm.nmId);
          const d = e?.discount ?? 0;
          const base = Math.round(priceConfirm.target / (1 - d / 100));
          // Фактическая цена «со скидкой», которую установит WB: целая база × скидка,
          // получается с копейками. Показываем именно её, а не округлённое введённое.
          const shelf = Math.round(base * (1 - d / 100) * 100) / 100;
          const overlay = props.priceChangeStatuses.get(priceConfirm.nmId);
          const oldFinal = overlay ? overlay.desiredFinal : (e?.priceWithDiscount ?? null);
          const product = props.filteredProducts.find((p) => p.nmId === priceConfirm.nmId);
          const label = product ? getDisplayVendorCode(product) : `#${String(priceConfirm.nmId)}`;
          return (
            <PriceConfirmModal
              productLabel={label}
              oldFinal={oldFinal}
              shelf={shelf}
              onConfirm={() => { void handleConfirmPrice(); }}
              onCancel={handleCancelPriceConfirm}
            />
          );
        })()}
      </section>
    );
  },
);
