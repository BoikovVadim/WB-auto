export function addWorkspaceNullableNumbers(
  currentValue: number | null,
  nextValue: number | null,
) {
  if (typeof nextValue !== "number") {
    return currentValue;
  }

  return (currentValue ?? 0) + nextValue;
}

export function averageWorkspaceNumbers(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function getWorkspaceRatio(numerator: number | null, denominator: number | null) {
  if (typeof numerator !== "number" || typeof denominator !== "number" || denominator === 0) {
    return null;
  }

  return (numerator / denominator) * 100;
}

export function getWorkspaceMoneyPerAction(money: number | null, actions: number | null) {
  if (typeof money !== "number" || typeof actions !== "number" || actions === 0) {
    return null;
  }

  return money / actions;
}

export function getWorkspaceCostPerThousand(money: number | null, views: number | null) {
  if (typeof money !== "number" || typeof views !== "number" || views === 0) {
    return null;
  }

  return (money / views) * 1000;
}

export function getWorkspaceOrderedItems(input: {
  orders: number | null;
  shks?: number | null;
}) {
  return typeof input.shks === "number" ? input.shks : input.orders;
}

export function coerceWorkspaceTotal(value: number | null) {
  return typeof value === "number" ? value : 0;
}

export function pickPreferredNullableNumber(currentValue: number | null, nextValue: number | null) {
  return currentValue ?? nextValue;
}
