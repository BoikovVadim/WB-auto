import { WbClustersRepositoryAcquiring } from "./wb-clusters.repository.acquiring";

export type SubjectCommissionRow = {
  subjectName: string;
  commissionPercent: number;
};

/** Глобальные %-метрики юнит-экономики (применяются ко всем товарам). */
export type GlobalPercentMetric = "tax" | "acquiring" | "drr";

export type GlobalSettings = {
  taxPercent: number | null;
  acquiringPercent: number | null;
  drrPercent: number | null;
};

// Метрика → колонка единственной строки настроек. Хардкод (никакой инъекции).
const GLOBAL_PERCENT_COLUMN: Record<GlobalPercentMetric, string> = {
  tax: "tax_percent",
  acquiring: "acquiring_percent",
  drr: "drr_percent",
};

/**
 * Настройки юнит-экономики: комиссия по предметам (subject_name → %) и единый
 * эквайринг (% в единственной строке настроек). Из них считается комиссия/эквайринг
 * в ₽ на каждый товар (см. сервис getUnitEconomicsCharges) — фронт только рисует.
 * Список предметов берётся из каталога (getDistinctSubjectNames).
 */
export abstract class WbClustersRepositoryUnitEconomics extends WbClustersRepositoryAcquiring {
  /** Сохранённые комиссии по предметам. */
  async getSubjectCommissions(): Promise<SubjectCommissionRow[]> {
    const result = await this.getPool().query<{ subject_name: string; commission_percent: string }>(
      `SELECT subject_name, commission_percent::text AS commission_percent
       FROM ${this.tableName("wb_unit_economics_subject_commission")}`,
    );
    return result.rows.map((r) => ({
      subjectName: r.subject_name,
      commissionPercent: Number(r.commission_percent),
    }));
  }

  /** Upsert комиссии (%) для предмета. */
  async upsertSubjectCommission(subjectName: string, commissionPercent: number): Promise<void> {
    await this.getPool().query(
      `INSERT INTO ${this.tableName("wb_unit_economics_subject_commission")}
         (subject_name, commission_percent, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (subject_name) DO UPDATE SET
         commission_percent = EXCLUDED.commission_percent,
         updated_at = NOW()`,
      [subjectName, commissionPercent],
    );
  }

  /** Очистка комиссии для предмета (строка удаляется → значение «не задано»). */
  async deleteSubjectCommission(subjectName: string): Promise<void> {
    await this.getPool().query(
      `DELETE FROM ${this.tableName("wb_unit_economics_subject_commission")} WHERE subject_name = $1`,
      [subjectName],
    );
  }

  /** Глобальные %-метрики (налог, эквайринг, ДРР); null — не задано. */
  async getGlobalSettings(): Promise<GlobalSettings> {
    const result = await this.getPool().query<{
      tax_percent: string | null;
      acquiring_percent: string | null;
      drr_percent: string | null;
    }>(
      `SELECT tax_percent::text       AS tax_percent,
              acquiring_percent::text AS acquiring_percent,
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
      taxPercent: parse(row?.tax_percent),
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
