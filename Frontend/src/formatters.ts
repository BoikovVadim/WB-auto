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

const WEEKDAY_FMT = new Intl.DateTimeFormat(ru, { weekday: "short", timeZone: "UTC" });

/**
 * "пн, 28.05.2026" — дата столбца матрицы с днём недели.
 * Вход — ISO `YYYY-MM-DD`. День недели считаем в UTC (через `Date.UTC`), чтобы он
 * совпадал с календарной датой независимо от таймзоны браузера.
 */
export function formatDateWithWeekday(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  const weekday = WEEKDAY_FMT.format(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return `${weekday}, ${day}.${month}.${year}`;
}
