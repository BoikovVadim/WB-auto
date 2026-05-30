import { WbClustersRepositoryUnitEconomics } from "./wb-clusters.repository.unit-economics";

export type MarginSnapshotRow = {
  nmId: number;
  priceWithDiscount: number;
  marginRub: number;
  marginPercent: number | null;
};

export type MarginSnapshotMatrix = {
  dates: string[];
  products: {
    nmId: number;
    marginRub: (number | null)[];
    marginPercent: (number | null)[];
    priceWithDiscount: (number | null)[];
  }[];
};

/**
 * Дневной снапшот маржи (₽/%) на товар — single source of truth для ретроспективы маржи.
 *
 * Хранит закрытые дни в wb_product_margin_daily_snapshot; «сегодня» считается на лету в
 * сервисе (та же формула marginAt). Серия копится вперёд от запуска, backfill не делаем —
 * маржа зависит от текущих настроек/цены/с-с, по прошлым дням недостоверна. price_with_discount
 * хранится рядом, чтобы взвешенный «Итого, %» совпадал с inline-колонкой «Маржа, %».
 */
export abstract class WbClustersRepositoryMarginSnapshot extends WbClustersRepositoryUnitEconomics {
  /** Дата (Москва) со смещением в днях, формат YYYY-MM-DD. offset=0 — сегодня, −1 — вчера. */
  async getMoscowDate(offsetDays: number): Promise<string> {
    const result = await this.getPool().query<{ d: string }>(
      `SELECT TO_CHAR((NOW() AT TIME ZONE 'Europe/Moscow')::date + $1::int, 'YYYY-MM-DD') AS d`,
      [offsetDays],
    );
    return result.rows[0]?.d ?? "";
  }

  /**
   * Апсертит снапшот маржи за указанную дату (одним запросом через UNNEST). Идемпотентно:
   * повтор за тот же день перезаписывает строки. Возвращает число записанных строк.
   */
  async upsertMarginSnapshotRows(snapshotDate: string, rows: MarginSnapshotRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const tbl = this.tableName("wb_product_margin_daily_snapshot");
    const nmIds = rows.map((r) => r.nmId);
    const prices = rows.map((r) => r.priceWithDiscount);
    const margins = rows.map((r) => r.marginRub);
    const percents = rows.map((r) => r.marginPercent);
    const result = await this.getPool().query(
      `INSERT INTO ${tbl}
         (nm_id, snapshot_date, price_with_discount, margin_rub, margin_percent, updated_at)
       SELECT u.nm_id, $1::date, u.price, u.margin, u.percent, NOW()
       FROM UNNEST($2::bigint[], $3::numeric[], $4::numeric[], $5::numeric[])
         AS u(nm_id, price, margin, percent)
       ON CONFLICT (nm_id, snapshot_date) DO UPDATE SET
         price_with_discount = EXCLUDED.price_with_discount,
         margin_rub          = EXCLUDED.margin_rub,
         margin_percent      = EXCLUDED.margin_percent,
         updated_at          = NOW()`,
      [snapshotDate, nmIds, prices, margins, percents],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Compact-матрица снапшота маржи: dates (DESC) + по товару выровненные массивы
   * marginRub/marginPercent/priceWithDiscount за каждую дату. Только закрытые дни
   * (сегодня в таблице нет — его считает сервис на лету). Sparse: пропуски — null.
   */
  async getMarginSnapshotMatrix(): Promise<MarginSnapshotMatrix> {
    const tbl = this.tableName("wb_product_margin_daily_snapshot");
    const result = await this.getPool().query<{
      nm_id: string;
      snapshot_date: string;
      margin_rub: string | null;
      margin_percent: string | null;
      price_with_discount: string | null;
    }>(
      // Без ORDER BY: даты сортируются ниже в JS, строки ключуются по nmId — текстовый
      // ORDER BY заставлял бы PG сортировать на диске.
      `SELECT nm_id::text,
              TO_CHAR(snapshot_date, 'YYYY-MM-DD') AS snapshot_date,
              margin_rub::text,
              margin_percent::text,
              price_with_discount::text
       FROM ${tbl}`,
    );
    if (result.rows.length === 0) return { dates: [], products: [] };

    const datesSet = new Set<string>();
    for (const r of result.rows) datesSet.add(r.snapshot_date);
    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1)); // DESC
    const dateIdx = new Map<string, number>();
    for (let i = 0; i < dates.length; i++) dateIdx.set(dates[i]!, i);

    const productMap = new Map<number, MarginSnapshotMatrix["products"][number]>();
    const num = (raw: string | null): number | null => (raw === null ? null : Number(raw));
    for (const r of result.rows) {
      const idx = dateIdx.get(r.snapshot_date);
      if (idx === undefined) continue;
      const nmId = Number(r.nm_id);
      let row = productMap.get(nmId);
      if (!row) {
        row = {
          nmId,
          marginRub: new Array<number | null>(dates.length).fill(null),
          marginPercent: new Array<number | null>(dates.length).fill(null),
          priceWithDiscount: new Array<number | null>(dates.length).fill(null),
        };
        productMap.set(nmId, row);
      }
      row.marginRub[idx] = num(r.margin_rub);
      row.marginPercent[idx] = num(r.margin_percent);
      row.priceWithDiscount[idx] = num(r.price_with_discount);
    }
    return { dates, products: Array.from(productMap.values()) };
  }
}
