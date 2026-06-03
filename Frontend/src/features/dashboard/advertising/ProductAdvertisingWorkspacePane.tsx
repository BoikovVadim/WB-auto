import { useEffect, useLayoutEffect, useRef } from "react";

import type { ProductAdvertisingWorkspaceResponse } from "../../../api/syncClient";
import { ui } from "../copy";
import type { AdvertisingDateRange } from "./date";
import type { ProductAdvertisingDetailRevisions } from "./productAdvertisingDetailInvalidation";
import {
  loadWorkspaceScroll,
  saveWorkspaceScroll,
} from "./productAdvertisingWorkspaceScroll";
import { ProductAdvertisingClusterTableSection } from "./ProductAdvertisingClusterTableSection";
import { ProductAdvertisingClusterTableSkeleton } from "./ProductAdvertisingClusterTableSkeleton";
import { ProductAdvertisingWorkspaceState } from "./ProductAdvertisingWorkspaceState";
import { useProductAdvertisingClusterSectionState } from "./useProductAdvertisingClusterSectionState";

export function ProductAdvertisingWorkspacePane(props: {
  nmId: number | null;
  vendorCode: string;
  detailRevisions: ProductAdvertisingDetailRevisions;
  workspace: ProductAdvertisingWorkspaceResponse | null;
  dateRange: AdvertisingDateRange;
  onDateRangeChange: (value: AdvertisingDateRange) => void;
  loadError: string | null;
  isWorkspaceLoading: boolean;
  isAdvertisingSyncStarting: boolean;
  onRunAdvertisingSync: () => void;
  onReloadSheet: (options?: {
    advertId?: number | null;
    target?: "workspace" | "table" | "queries" | "detail" | "all";
    invalidateCaches?: boolean;
  }) => Promise<void>;
}) {
  // Показываем контент только когда workspace НЕ null.
  // При null (первый вход в товар, холодный кеш) — показываем ничего, пока данные грузятся.
  // Это предотвращает рендер с workspace=null при isLoading=true, который вызывал
  // пустой «Список кампаний товара» без единой РК.
  // Когда workspace уже есть — НЕ размонтируем Content даже при isWorkspaceLoading:
  // это сохраняет локальный стейт (фильтр, страница, кластеры) при смене дат/пресетов.
  if (!props.workspace) {
    if (props.loadError) {
      return (
        <div className="wb-products-page">
          <ProductAdvertisingWorkspaceState
            title={ui.campaignOverviewTitle}
            message={props.loadError}
          />
        </div>
      );
    }
    // Пока workspace=null (холодный старт, нет даже latest-кэша) — показываем сразу
    // скелетон-каркас таблицы РК, а не текстовую «фразу». Это убирает лишнее визуальное
    // переключение «фраза → каркас со скелетоном» и совпадает с финальным макетом.
    return (
      <div className="wb-products-page">
        <section className="wb-product-workspace">
          <ProductAdvertisingClusterTableSkeleton />
        </section>
      </div>
    );
  }

  return <ProductAdvertisingWorkspaceContent {...props} />;
}

function ProductAdvertisingWorkspaceContent(props: {
  nmId: number | null;
  vendorCode: string;
  detailRevisions: ProductAdvertisingDetailRevisions;
  workspace: ProductAdvertisingWorkspaceResponse | null;
  dateRange: AdvertisingDateRange;
  onDateRangeChange: (value: AdvertisingDateRange) => void;
  loadError: string | null;
  isWorkspaceLoading: boolean;
  isAdvertisingSyncStarting: boolean;
  onRunAdvertisingSync: () => void;
  onReloadSheet: (options?: {
    advertId?: number | null;
    target?: "workspace" | "table" | "queries" | "detail" | "all";
    invalidateCaches?: boolean;
  }) => Promise<void>;
}) {
  const { sectionProps } = useProductAdvertisingClusterSectionState({
    nmId: props.nmId,
    detailRevisions: props.detailRevisions,
    workspace: props.workspace,
    dateRange: props.dateRange,
    onDateRangeChange: props.onDateRangeChange,
    isAdvertisingSyncStarting: props.isAdvertisingSyncStarting,
    onRunAdvertisingSync: props.onRunAdvertisingSync,
    onReloadSheet: props.onReloadSheet,
  });

  const sectionRef = useRef<HTMLElement>(null);
  const nmId = props.nmId;

  // Restore scroll position after mount (layout effect to run before paint).
  useLayoutEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const saved = loadWorkspaceScroll(nmId);
    if (saved > 0) {
      el.scrollTop = saved;
    }
  }, [nmId]);

  // Persist scroll position on scroll.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const handler = () => saveWorkspaceScroll(nmId, el.scrollTop);
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [nmId]);

  return (
    <div className="wb-products-page">
      <section ref={sectionRef} className="wb-product-workspace">
        <ProductAdvertisingClusterTableSection
          {...sectionProps}
          isWorkspaceLoading={props.isWorkspaceLoading}
        />
      </section>
    </div>
  );
}
