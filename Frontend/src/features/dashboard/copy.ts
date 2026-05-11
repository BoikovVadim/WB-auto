import { dashboardUiCopyAdvertising } from "./copy/dashboardUiCopyAdvertising";
import { dashboardUiCopyProducts } from "./copy/dashboardUiCopyProducts";
import { dashboardUiCopyShell } from "./copy/dashboardUiCopyShell";
import { dashboardUiCopyTables } from "./copy/dashboardUiCopyTables";

export const ui = {
  ...dashboardUiCopyShell,
  products: "Товары",
  searchTexts: "Поисковые фразы",
  pagesFetched: "Страниц отчета",
  batchesFetched: "Пакетов top фраз",
  ...dashboardUiCopyTables,
  ...dashboardUiCopyProducts,
  ...dashboardUiCopyAdvertising,
} as const;
