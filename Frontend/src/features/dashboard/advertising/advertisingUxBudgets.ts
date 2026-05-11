export const advertisingUxBudgetsMs = {
  dashboardShellVisible: 220,
  sectionSwitch: 120,
  savedExportVisible: 160,
  productsSearchVisible: 24,
  methodTableVisible: 180,
  repeatProductOpen: 120,
  dateChangeShellVisible: 200,
  repeatClusterExpand: 120,
  localInteraction: 16,
} as const;

type PendingBudget = {
  label: string;
  startedAt: number;
  budgetMs: number;
};

const pendingBudgets = new Map<string, PendingBudget>();

export function startAdvertisingUxBudget(key: string, label: string, budgetMs: number) {
  if (typeof performance === "undefined") {
    return;
  }

  pendingBudgets.set(key, {
    label,
    startedAt: performance.now(),
    budgetMs,
  });
}

export function completeAdvertisingUxBudget(key: string) {
  if (typeof performance === "undefined") {
    return;
  }

  const pendingBudget = pendingBudgets.get(key);
  if (!pendingBudget) {
    return;
  }

  pendingBudgets.delete(key);
  const elapsedMs = performance.now() - pendingBudget.startedAt;
  if (elapsedMs <= pendingBudget.budgetMs || !shouldLogAdvertisingUxBudgetMiss()) {
    return;
  }

  console.warn(
    `[advertising-ux-budget] ${pendingBudget.label} exceeded ${String(
      pendingBudget.budgetMs,
    )}ms budget (${Math.round(elapsedMs)}ms).`,
  );
}

function shouldLogAdvertisingUxBudgetMiss() {
  if (typeof window === "undefined") {
    return false;
  }

  return import.meta.env.DEV || window.localStorage.getItem("wb-debug-ux-budgets") === "1";
}
