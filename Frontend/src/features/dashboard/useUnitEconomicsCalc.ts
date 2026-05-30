import { useCallback, useEffect, useRef, useState } from "react";

import { fetchUnitEconomicsCalc } from "../../api/syncClientUnitEconomics";

// Вводы калькулятора — планировочный «что если», переживают перезагрузку/навигацию.
const MARGIN_LS_KEY = "wb-unit-econ-calc-target-margin";
const PRICE_LS_KEY = "wb-unit-econ-calc-price";
// Коммит идёт по Enter/blur (выход из ячейки), не на каждый символ — небольшой дебаунс
// лишь схлопывает быстрый перебор нескольких ячеек подряд в один запрос.
const DEBOUNCE_MS = 120;

export type UseUnitEconomicsCalcResult = {
  /** Введённая целевая маржа % по nmId (для seed инпута и сортировки). */
  marginInputs: Map<number, number>;
  /** Введённая гипотетическая цена со скидкой по nmId. */
  priceInputs: Map<number, number>;
  /** Нужная цена со скидкой под целевую маржу; null — маржа недостижима/нет с/с. */
  priceResults: Map<number, number | null>;
  /** Итоговая маржа % при введённой цене; null — нет с/с/цена ≤ 0. */
  marginResults: Map<number, number | null>;
  setMarginInput: (nmId: number, value: number | null) => void;
  setPriceInput: (nmId: number, value: number | null) => void;
};

function loadStored(key: string): Map<number, number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, number>;
    const map = new Map<number, number>();
    for (const [k, v] of Object.entries(obj)) {
      const nmId = Number(k);
      if (Number.isFinite(nmId) && typeof v === "number" && Number.isFinite(v)) map.set(nmId, v);
    }
    return map;
  } catch {
    return new Map();
  }
}

function persist(key: string, map: Map<number, number>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(map)));
  } catch {
    /* приватный режим / квота — просто не сохраняем */
  }
}

/**
 * Состояние двух калькуляторов раздела «Юнит Экономика»: «целевая маржа → цена» и
 * «цена → маржа». Источник истины формул — бэкенд (POST /unit-economics/calc на том же
 * базисе, что колонка маржи); фронт хранит вводы и рисует ответ.
 *
 * Набор не дёргает ре-рендер секции: вводы пишутся в ref, через DEBOUNCE_MS зеркалятся в
 * state (для seed инпута/сортировки/персиста) и одним батч-запросом считаются на сервере.
 * `enabled` (true только в «Юнит Экономике») гейтит загрузку/расчёт, чтобы в «Товарах»,
 * где колонки скрыты, не было лишних сетевых вызовов.
 */
export function useUnitEconomicsCalc(enabled: boolean): UseUnitEconomicsCalcResult {
  const marginRef = useRef<Map<number, number>>(new Map());
  const priceRef = useRef<Map<number, number>>(new Map());
  const [marginInputs, setMarginInputs] = useState<Map<number, number>>(new Map());
  const [priceInputs, setPriceInputs] = useState<Map<number, number>>(new Map());
  const [priceResults, setPriceResults] = useState<Map<number, number | null>>(new Map());
  const [marginResults, setMarginResults] = useState<Map<number, number | null>>(new Map());

  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Последовательность запросов: применяем только ответ самого свежего (Enter-коммиты
  // могут гоняться — без guard поздно пришедший старый ответ затёр бы новый расчёт).
  const requestSeqRef = useRef(0);

  const commit = useCallback(() => {
    const margin = new Map(marginRef.current);
    const price = new Map(priceRef.current);
    setMarginInputs(margin);
    setPriceInputs(price);
    persist(MARGIN_LS_KEY, margin);
    persist(PRICE_LS_KEY, price);

    if (margin.size === 0 && price.size === 0) {
      setPriceResults(new Map());
      setMarginResults(new Map());
      return;
    }
    const seq = ++requestSeqRef.current;
    fetchUnitEconomicsCalc({
      marginToPrice: Array.from(margin, ([nmId, targetMarginPercent]) => ({
        nmId,
        targetMarginPercent,
      })),
      priceToMargin: Array.from(price, ([nmId, value]) => ({ nmId, price: value })),
    })
      .then((res) => {
        if (!mountedRef.current || seq !== requestSeqRef.current) return;
        const priceMap = new Map<number, number | null>();
        for (const it of res.marginToPrice) priceMap.set(it.nmId, it.feasible ? it.price : null);
        const marginMap = new Map<number, number | null>();
        for (const it of res.priceToMargin) marginMap.set(it.nmId, it.marginPercent);
        setPriceResults(priceMap);
        setMarginResults(marginMap);
      })
      .catch(() => {
        /* оставляем прежние результаты */
      });
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(commit, DEBOUNCE_MS);
  }, [commit]);

  const setMarginInput = useCallback(
    (nmId: number, value: number | null) => {
      if (value === null || !Number.isFinite(value)) marginRef.current.delete(nmId);
      else marginRef.current.set(nmId, value);
      schedule();
    },
    [schedule],
  );

  const setPriceInput = useCallback(
    (nmId: number, value: number | null) => {
      if (value === null || !Number.isFinite(value) || value <= 0) priceRef.current.delete(nmId);
      else priceRef.current.set(nmId, value);
      schedule();
    },
    [schedule],
  );

  // Загрузка сохранённых вводов и первичный расчёт — только когда раздел активен.
  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;
    marginRef.current = loadStored(MARGIN_LS_KEY);
    priceRef.current = loadStored(PRICE_LS_KEY);
    if (marginRef.current.size > 0 || priceRef.current.size > 0) commit();
    else {
      setMarginInputs(new Map(marginRef.current));
      setPriceInputs(new Map(priceRef.current));
    }
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, commit]);

  return {
    marginInputs,
    priceInputs,
    priceResults,
    marginResults,
    setMarginInput,
    setPriceInput,
  };
}
