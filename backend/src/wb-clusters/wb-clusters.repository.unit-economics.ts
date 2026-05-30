import { WbClustersRepositoryPrices } from "./wb-clusters.repository.prices";

export type CategoryCommissionRow = {
  categoryName: string;
  commissionPercent: number;
};

/**
 * Настройки юнит-экономики: комиссия по категориям (category_name → %) и единый
 * эквайринг (% в единственной строке настроек). Из них считается комиссия/эквайринг
 * в ₽ на каждый товар (см. сервис getUnitEconomicsCharges) — фронт только рисует.
 */
export abstract class WbClustersRepositoryUnitEconomics extends WbClustersRepositoryPrices {
  /** Уникальные родительские категории каталога (category_name), по алфавиту. */
  async getDistinctCategoryNames(): Promise<string[]> {
    const result = await this.getPool().query<{ category_name: string }>(
      `SELECT DISTINCT category_name
       FROM ${this.tableName("wb_product_catalog")}
       WHERE vendor_code <> '' AND category_name IS NOT NULL AND category_name <> ''
       ORDER BY category_name`,
    );
    return result.rows.map((r) => r.category_name);
  }

  /** Сохранённые комиссии по категориям. */
  async getCategoryCommissions(): Promise<CategoryCommissionRow[]> {
    const result = await this.getPool().query<{ category_name: string; commission_percent: string }>(
      `SELECT category_name, commission_percent::text AS commission_percent
       FROM ${this.tableName("wb_unit_economics_category_commission")}`,
    );
    return result.rows.map((r) => ({
      categoryName: r.category_name,
      commissionPercent: Number(r.commission_percent),
    }));
  }

  /** Upsert комиссии (%) для категории. */
  async upsertCategoryCommission(categoryName: string, commissionPercent: number): Promise<void> {
    await this.getPool().query(
      `INSERT INTO ${this.tableName("wb_unit_economics_category_commission")}
         (category_name, commission_percent, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (category_name) DO UPDATE SET
         commission_percent = EXCLUDED.commission_percent,
         updated_at = NOW()`,
      [categoryName, commissionPercent],
    );
  }

  /** Очистка комиссии для категории (строка удаляется → значение «не задано»). */
  async deleteCategoryCommission(categoryName: string): Promise<void> {
    await this.getPool().query(
      `DELETE FROM ${this.tableName("wb_unit_economics_category_commission")} WHERE category_name = $1`,
      [categoryName],
    );
  }

  /** Глобальный эквайринг (%) или null, если не задан. */
  async getAcquiringPercent(): Promise<number | null> {
    const result = await this.getPool().query<{ acquiring_percent: string | null }>(
      `SELECT acquiring_percent::text AS acquiring_percent
       FROM ${this.tableName("wb_unit_economics_settings")} WHERE id = 1`,
    );
    const row = result.rows[0];
    if (!row || row.acquiring_percent === null) return null;
    const value = Number(row.acquiring_percent);
    return Number.isFinite(value) ? value : null;
  }

  /** Запись глобального эквайринга (%); null очищает значение. */
  async setAcquiringPercent(acquiringPercent: number | null): Promise<void> {
    await this.getPool().query(
      `INSERT INTO ${this.tableName("wb_unit_economics_settings")} (id, acquiring_percent, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET
         acquiring_percent = EXCLUDED.acquiring_percent,
         updated_at = NOW()`,
      [acquiringPercent],
    );
  }
}
