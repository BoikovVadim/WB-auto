/**
 * Project-wide formatting rules.
 *
 * **2 знака после запятой** — для процентов и денег **везде**.
 * Не отклоняться от этого правила без явного указания пользователя.
 */

const ru = "ru-RU";
const FRAC = 2;

/** "12,34 %" — для любых процентных значений, включая null/NaN → "—". */
export function formatPercent(value: number | null | undefined, opts?: { fallback?: string }): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return opts?.fallback ?? "—";
  }
  return `${value.toLocaleString(ru, { minimumFractionDigits: FRAC, maximumFractionDigits: FRAC })} %`;
}

/** "12 345,67 ₽" — для денежных сумм. */
export function formatMoney(value: number | null | undefined, opts?: { fallback?: string }): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return opts?.fallback ?? "—";
  }
  return `${value.toLocaleString(ru, { minimumFractionDigits: FRAC, maximumFractionDigits: FRAC })} ₽`;
}
