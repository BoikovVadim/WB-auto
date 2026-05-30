import { WbClustersRepositoryPrices } from "./wb-clusters.repository.prices";

export type CategoryCommissionRow = {
  categoryName: string;
  commissionPercent: number;
};

/** Глобальные %-метрики юнит-экономики (применяются ко всем товарам). */
export type GlobalPercentMetric = "acquiring" | "drr";

export type GlobalSettings = {
  acquiringPercent: number | null;
  drrPercent: number | null;
};

// Метрика → колонка единственной строки настроек. Хардкод (никакой инъекции).
const GLOBAL_PERCENT_COLUMN: Record<GlobalPercentMetric, string> = {
  acquiring: "acquiring_percent",
  drr: "drr_percent",
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

  /** Глобальные %-метрики (эквайринг, ДРР); null — не задано. */
  async getGlobalSettings(): Promise<GlobalSettings> {
    const result = await this.getPool().query<{
      acquiring_percent: string | null;
      drr_percent: string | null;
    }>(
      `SELECT acquiring_percent::text AS acquiring_percent,
              drr_percent::text       AS drr_percent
       FROM ${this.tableName("wb_unit_economics_settings")} WHERE id = 1`,
    );
    const row = result.rows[0];
    const parse = (raw: string | null | undefined): number | null => {
      if (raw === null || raw === undefined) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    return {
      acquiringPercent: parse(row?.acquiring_percent),
      drrPercent: parse(row?.drr_percent),
    };
  }

  /** Запись глобальной %-метрики; null очищает значение. */
  async setGlobalPercent(metric: GlobalPercentMetric, value: number | null): Promise<void> {
    const column = GLOBAL_PERCENT_COLUMN[metric];
    await this.getPool().query(
      `INSERT INTO ${this.tableName("wb_unit_economics_settings")} (id, ${column}, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET
         ${column} = EXCLUDED.${column},
         updated_at = NOW()`,
      [value],
    );
  }
}
