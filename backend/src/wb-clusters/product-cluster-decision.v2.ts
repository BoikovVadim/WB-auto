import type {
  AutomationMode,
  ClusterAutomationStateValue,
  ClusterReviewStatus,
} from "./wb-clusters.repository.automation";
import { round2, type ClusterDecision } from "./product-cluster-decision";

/**
 * Вход решения v2 — НАКОПИТЕЛЬНЫЕ счётчики кластера из ТЕКУЩЕЙ ценовой корзины (не скользящие
 * 30 дней). См. wb-clusters.repository.accrual.ts и память project-cluster-ad-strategy.
 */
export interface ClusterAccrualDecisionInput {
  normalizedClusterName: string;
  clusterName: string;
  /** Текущее состояние на WB: 'active' | 'excluded' | прочее (из синка/overlay действий). */
  currentSourceKind: string | null;
  /** Накопленный расход РК в текущей корзине (₽). */
  accruedSpend: number;
  /** Накопленные заказы РК. */
  accruedOrdersRk: number;
  /** Накопленные JAM-заказы (halo: реклама сеет отложенные органические заказы). */
  accruedOrdersJam: number;
}

/**
 * Чистое решение по кластеру — ПРАВИЛО v2 (фаза LEARNING на накопительных счётчиках).
 * Приоритеты сверху вниз: модерация (pending) → чёрный → белый → ручная защита → CPO-правило.
 *
 * Отличие от v1: судим не по скользящему 30-дн окну, а по НАКОПЛЕННОМУ расходу/заказам, и не
 * режем бесзаказный кластер по шуму малой выборки — держим в LEARNING, пока накопленный расход
 * не достигнет 2× Макс СРО (порог терпения). CPO = accruedSpend / max(заказы РК, JAM) — max даёт
 * кластеру «зачёт» за halo-заказы. Макс СРО (maxCpo) — уже ×2 от целевого (константа метрики).
 *
 * Состояния: 'learning' (0 заказов, расход < 2× Макс — копим) | 'active' (CPO ≤ Макс) |
 * 'excluded_high' (0 заказов и расход ≥ 2× Макс — надёжно плохой; ИЛИ есть заказы и CPO > Макс).
 * Регулятор ДРР (excluded_drr) и авто-OFF новых — отдельные слои, не здесь.
 */
export function decideForClusterV2(
  input: ClusterAccrualDecisionInput,
  maxCpo: number,
  prev:
    | { state: ClusterAutomationStateValue; manualProtected: boolean; lastDecision: string | null }
    | undefined,
  mode: AutomationMode,
  roles: {
    isProtected: boolean;
    isBlacklisted: boolean;
    reviewStatus: ClusterReviewStatus;
    /** Придержан регулятором дневного ДРР — держим excluded_drr, пока регулятор не снимет. */
    drrHeld: boolean;
  },
): ClusterDecision {
  const isExcludedNow = input.currentSourceKind === "excluded";
  const ordered = Math.max(input.accruedOrdersRk, input.accruedOrdersJam);
  // CPO определён только при наличии заказов; иначе показываем накопленный расход (как «стоимость»).
  const cpo =
    ordered > 0 ? input.accruedSpend / ordered : input.accruedSpend > 0 ? input.accruedSpend : null;
  const effectiveCpo = cpo != null ? round2(cpo) : null;

  const base = {
    normalizedClusterName: input.normalizedClusterName,
    clusterName: input.clusterName,
    effectiveCpo,
    spend: input.accruedSpend,
  };

  // Модерация — наивысший приоритет. Новый кластер (ВБ добавил после baseline) движок НЕ
  // трогает (decision=noop, остаётся как есть на WB) — решение принимает человек руками.
  // Движок лишь ПОДПИСЫВАЕТ рекомендацию (suggestedReviewAction, считается отдельно мусор-
  // фильтром релевантности и сохраняется в state) — см. product-cluster-relevance.ts.
  if (roles.reviewStatus === "pending") {
    return {
      ...base,
      state: "pending_review",
      manualProtected: false,
      decision: "noop",
      reviewStatus: "pending",
    };
  }
  // Чёрный список — никогда не включать.
  if (roles.isBlacklisted) {
    return {
      ...base,
      state: "blacklisted",
      manualProtected: false,
      decision: isExcludedNow ? "noop" : "exclude",
      reviewStatus: roles.reviewStatus,
    };
  }
  // Белый список — всегда активен.
  if (roles.isProtected) {
    return {
      ...base,
      state: "protected",
      manualProtected: false,
      decision: isExcludedNow ? "include" : "noop",
      reviewStatus: roles.reviewStatus,
    };
  }

  // Удержание регулятором дневного ДРР: кластер рентабельный, но временно отключён ради
  // удержания ДРР у плана. Держим excluded_drr, пока регулятор не снимет drr_held (при недотрате
  // ДРР). Приоритет ниже ручных списков (человек важнее), но выше базового CPO-правила.
  if (roles.drrHeld) {
    return {
      ...base,
      state: "excluded_drr",
      manualProtected: false,
      decision: isExcludedNow ? "noop" : "exclude",
      reviewStatus: roles.reviewStatus,
    };
  }

  // Ручная защита: в live сотрудник вернул выбывший кластер → иммунитет к выбыванию по «нет данных».
  let manualProtected = prev?.manualProtected ?? false;
  if (mode === "live" && !isExcludedNow && prev?.lastDecision === "exclude") {
    manualProtected = true;
  }

  // CPO-правило v2 с фазой LEARNING.
  let desiredActive: boolean;
  let state: ClusterAutomationStateValue;
  if (ordered === 0) {
    // Заказов нет: пока накопленный расход не дорос до 2× Макс СРО — НЕ судим (шум малой выборки),
    // держим в LEARNING. Достиг порога терпения без единого заказа → надёжно плохой → исключаем.
    if (input.accruedSpend < 2 * maxCpo) {
      desiredActive = true;
      state = manualProtected ? "manual_protected" : "learning";
    } else {
      desiredActive = false;
      state = "excluded_high";
      manualProtected = false;
    }
  } else if (cpo !== null && cpo <= maxCpo) {
    desiredActive = true;
    state = "active";
    manualProtected = false;
  } else {
    desiredActive = false;
    state = "excluded_high";
    manualProtected = false;
  }

  let decision: ClusterDecision["decision"] = "noop";
  if (desiredActive && isExcludedNow) decision = "include";
  else if (!desiredActive && !isExcludedNow) decision = "exclude";

  return { ...base, state, manualProtected, decision, reviewStatus: roles.reviewStatus };
}
