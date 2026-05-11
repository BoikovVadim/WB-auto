import type { MetricValue } from "../../../api/syncClient";

export function formatMetric(metric: MetricValue) {
  return `${formatNullableNumber(metric.current)} | ${formatNullableNumber(metric.dynamics)}`;
}

export function formatNullableNumber(value: number | null) {
  return value === null ? "-" : formatDecimalNumber(value);
}

export function formatPercentRatio(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || denominator <= 0) {
    return "-";
  }

  return `${formatDecimalNumber((numerator / denominator) * 100)}%`;
}

export function formatNullablePercent(value: number | null) {
  return value === null ? "-" : `${formatDecimalNumber(value)}%`;
}

export function formatMoneyValue(value: number | null, currency: string | null) {
  if (value === null) {
    return "-";
  }

  const formattedValue = formatDecimalNumber(value);
  return currency ? `${formattedValue} ${currency}` : formattedValue;
}

export function formatDecimalNumber(value: number) {
  return value
    .toLocaleString("ru-RU", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
    .replace(/\u00a0/g, " ");
}
