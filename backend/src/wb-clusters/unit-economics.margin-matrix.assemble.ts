import type { MarginMatrix } from "./unit-economics.service";

/** Снапшот закрытых дней (из repository.getMarginSnapshotMatrix) — структурный тип для сборки. */
type SnapshotProduct = {
  nmId: number;
  marginRub: (number | null)[];
  marginPercent: (number | null)[];
  priceWithDiscount: (number | null)[];
};
type SnapshotMatrix = { dates: string[]; products: SnapshotProduct[] };

/** Посчитанная «сегодня»-маржа по товару (live, по эффективной цене и с/с). */
export type TodayMargin = { marginRub: number; marginPercent: number | null; price: number };

/**
 * Чистая сборка маржинальной матрицы: колонка «сегодня» (live) + закрытые дни из снапшота (DESC).
 * Вынесена из UnitEconomicsService — без БД/DI, легко тестируется и держит сервис под порогом строк.
 */
export function assembleMarginMatrix(
  snapshot: SnapshotMatrix,
  today: string,
  todayByNmId: Map<number, TodayMargin>,
): MarginMatrix {
  // Закрытые дни снапшота без сегодня (на случай ручного снапшота за сегодня) — DESC.
  const pastDates = snapshot.dates.filter((d) => d !== today);
  const pastSnapshotIdx = pastDates.map((d) => snapshot.dates.indexOf(d));
  const dates = [today, ...pastDates];

  const snapByNmId = new Map(snapshot.products.map((p) => [p.nmId, p]));
  const nmIds = new Set<number>([...todayByNmId.keys(), ...snapByNmId.keys()]);

  const products: MarginMatrix["products"] = [];
  for (const nmId of nmIds) {
    const marginRub = new Array<number | null>(dates.length).fill(null);
    const marginPercent = new Array<number | null>(dates.length).fill(null);
    const priceWithDiscount = new Array<number | null>(dates.length).fill(null);

    const t = todayByNmId.get(nmId);
    if (t) {
      marginRub[0] = t.marginRub;
      marginPercent[0] = t.marginPercent;
      priceWithDiscount[0] = t.price;
    }
    const snap = snapByNmId.get(nmId);
    if (snap) {
      for (let i = 0; i < pastDates.length; i++) {
        const si = pastSnapshotIdx[i]!;
        marginRub[i + 1] = snap.marginRub[si] ?? null;
        marginPercent[i + 1] = snap.marginPercent[si] ?? null;
        priceWithDiscount[i + 1] = snap.priceWithDiscount[si] ?? null;
      }
    }
    products.push({ nmId, marginRub, marginPercent, priceWithDiscount });
  }

  return { today, dates, products };
}
