import type {
  AutomationMode,
  ClusterAutomationStateValue,
  ClusterCpoInput,
  ClusterReviewStatus,
} from "./wb-clusters.repository.automation";

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface ClusterDecision {
  normalizedClusterName: string;
  clusterName: string;
  effectiveCpo: number | null;
  /** Расход кластера за окно — для отображения «стоимости» там, где CPO неопределён (нет заказов). */
  spend: number | null;
  state: ClusterAutomationStateValue;
  manualProtected: boolean;
  /** Действие относительно текущего состояния на WB. */
  decision: "include" | "exclude" | "noop";
  /** Модерация: 'pending' — новый кластер на проверке (движок не трогает); 'approved' — в работе. */
  reviewStatus: ClusterReviewStatus;
}

/**
 * Чистое решение по одному кластеру. Приоритет: модерация (pending) → чёрный → белый →
 * CPO-правило. CPO = spend / max(заказы РК, джем-заказы) (РК-часть = shks ?? orders_РК); при
 * 0 заказов = сам расход. ≤ макс → включить, > макс → исключить, нет расхода → кандидат active.
 */
export function decideForCluster(
  input: ClusterCpoInput,
  maxCpo: number,
  prev: { state: ClusterAutomationStateValue; manualProtected: boolean; lastDecision: string | null } | undefined,
  mode: AutomationMode,
  roles: { isProtected: boolean; isBlacklisted: boolean; reviewStatus: ClusterReviewStatus },
): ClusterDecision {
  const isExcludedNow = input.currentSourceKind === "excluded";
  // Знаменатель CPO = max(заказы РК, джем-заказы): даём кластеру «зачёт» за
  // органические/джемовые заказы. РК-часть — заказанные товары shks, если есть,
  // иначе заказы РК. JAM = 0 при отсутствии, тогда max сводится к РК-части.
  // Та же формула в колонке «СРО» таблицы (getAdvertisingCpoOrderedItems на фронте).
  const rkOrdered = input.shks !== null ? input.shks : input.ordersRk;
  const orderedItems = Math.max(rkOrdered, input.ordersJam);
  // «CPO» = ровно getAdvertisingCpoOrSpend: есть заказы → расход/заказы; нет заказов,
  // но есть расход → показываем расход (это и есть «сумма» в колонке); нет расхода → null.
  const displayCpo =
    orderedItems > 0 ? input.spend / orderedItems : input.spend > 0 ? input.spend : null;
  const effectiveCpoForDisplay = displayCpo != null ? round2(displayCpo) : null;

  // Гейт модерации — НАИВЫСШИЙ приоритет: новый кластер (ВБ добавил после baseline) ждёт
  // ручной проверки. Движок его НЕ трогает (decision=noop), держит текущее состояние на WB.
  // CPO (effectiveCpoForDisplay) считаем только для предпросмотра в модалке ревью.
  if (roles.reviewStatus === "pending") {
    return {
      normalizedClusterName: input.normalizedClusterName,
      clusterName: input.clusterName,
      effectiveCpo: effectiveCpoForDisplay,
      spend: input.spend,
      state: "pending_review",
      manualProtected: false,
      decision: "noop",
      reviewStatus: "pending",
    };
  }

  // Чёрный список — наивысший приоритет: кластер никогда не должен быть включён.
  // Если сейчас активен на WB — исключаем; иначе noop.
  if (roles.isBlacklisted) {
    return {
      normalizedClusterName: input.normalizedClusterName,
      clusterName: input.clusterName,
      effectiveCpo: effectiveCpoForDisplay,
      spend: input.spend,
      state: "blacklisted",
      manualProtected: false,
      decision: isExcludedNow ? "noop" : "exclude",
      reviewStatus: roles.reviewStatus,
    };
  }

  // Белый список — приоритет над CPO-правилом: кластер всегда активен. Если сейчас
  // исключён на WB — включаем; иначе noop. CPO считаем только для отображения.
  if (roles.isProtected) {
    return {
      normalizedClusterName: input.normalizedClusterName,
      clusterName: input.clusterName,
      effectiveCpo: effectiveCpoForDisplay,
      spend: input.spend,
      state: "protected",
      manualProtected: false,
      decision: isExcludedNow ? "include" : "noop",
      reviewStatus: roles.reviewStatus,
    };
  }

  // Ручная защита: в live, если кластер сейчас активен, а автоматика в прошлый прогон
  // его исключала — значит сотрудник вернул вручную → иммунитет к выбыванию по «нет данных».
  let manualProtected = prev?.manualProtected ?? false;
  if (mode === "live" && !isExcludedNow && prev?.lastDecision === "exclude") {
    manualProtected = true;
  }

  // Решение РОВНО по числу из колонки «СРО»: ≤ макс. CPO товара → кластер работает
  // (включить), > макс → исключить. Есть заказы или нет — неважно: важно само значение
  // в колонке (при 0 заказов это расход = «сумма»). Если расхода вовсе нет
  // (displayCpo=null) → сигнала против нет → кандидат в активные.
  let desiredActive: boolean;
  let state: ClusterAutomationStateValue;
  if (displayCpo === null) {
    desiredActive = true;
    state = manualProtected ? "manual_protected" : "active";
  } else if (displayCpo <= maxCpo) {
    desiredActive = true;
    state = "active";
    manualProtected = false; // CPO в пределах плана — защита не нужна
  } else {
    desiredActive = false;
    state = "excluded_high";
    manualProtected = false; // авто-исключение по CPO сильнее ручной защиты
  }

  let decision: ClusterDecision["decision"] = "noop";
  if (desiredActive && isExcludedNow) decision = "include";
  else if (!desiredActive && !isExcludedNow) decision = "exclude";

  return {
    normalizedClusterName: input.normalizedClusterName,
    clusterName: input.clusterName,
    effectiveCpo: effectiveCpoForDisplay,
    spend: input.spend,
    state,
    manualProtected,
    decision,
    reviewStatus: roles.reviewStatus,
  };
}
