import { WbClustersRepositoryMarginSnapshot } from "./wb-clusters.repository.margin-snapshot";

export type ClusterAutomationStateValue =
  | "active"
  | "excluded_high"
  | "dropped"
  | "manual_protected"
  | "protected"
  | "blacklisted"
  // Новый кластер, добавленный ВБ после baseline: ждёт ручной модерации, движок его не трогает.
  | "pending_review"
  // Правило v2: бесзаказный кластер набирает данные (накопл. расход < 2× Макс СРО) — держим, копим.
  | "learning"
  // Правило v2 / регулятор ДРР: рентабельный кластер придержан ради дневного ДРР (вернётся сам).
  | "excluded_drr";

/** Статус модерации кластера: 'pending' (на проверке) | 'approved' (в работе у автоматики). */
export type ClusterReviewStatus = "pending" | "approved";

/** Строка пикера «Настройка фильтров»: кластер + его состояние и роли (белый/чёрный). */
export interface ClusterOverridePickerRow {
  normalizedClusterName: string;
  clusterName: string;
  lastCpo: number | null;
  /** Расход кластера за окно — для «стоимости» там, где заказов нет и CPO неопределён. */
  lastSpend: number | null;
  state: ClusterAutomationStateValue | null;
  isProtected: boolean;
  isBlacklisted: boolean;
}

/** Один override-элемент при сохранении набора (имя + отображаемое имя). */
export interface ClusterOverrideItem {
  normalizedClusterName: string;
  clusterName: string;
}

/**
 * Звено репозитория: ручные override пользователя (белый/чёрный список) поверх движка +
 * модерация новых кластеров (baseline кампании и review_status). База для
 * WbClustersRepositoryAutomation. Таблицы: wb_cluster_automation_override, поля
 * baselined_at (wb_campaign_automation) и review_status (wb_cluster_automation_state).
 */
export abstract class WbClustersRepositoryAutomationOverrides extends WbClustersRepositoryMarginSnapshot {
  /** baselined_at кампании: момент фиксации исходного набора кластеров (null — ещё не было). */
  async getCampaignBaselinedAt(advertId: number, nmId: number): Promise<string | null> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{ baselined_at: string | null }>(
      `SELECT baselined_at::text FROM ${this.tableName("wb_campaign_automation")}
       WHERE advert_id = $1 AND nm_id = $2`,
      [advertId, nmId],
    );
    return result.rows[0]?.baselined_at ?? null;
  }

  /** Зафиксировать baseline (грандфазер завершён) — только если ещё не стоял. */
  async markCampaignBaselined(advertId: number, nmId: number): Promise<void> {
    await this.ensureSchemaOrThrow();
    await this.getPool().query(
      `UPDATE ${this.tableName("wb_campaign_automation")}
         SET baselined_at = NOW()
       WHERE advert_id = $1 AND nm_id = $2 AND baselined_at IS NULL`,
      [advertId, nmId],
    );
  }

  /** Сменить статус модерации одного кластера (на проверке → в работе). */
  async setClusterReviewStatus(
    advertId: number,
    nmId: number,
    normalizedClusterName: string,
    status: ClusterReviewStatus,
  ): Promise<void> {
    await this.ensureSchemaOrThrow();
    await this.getPool().query(
      `UPDATE ${this.tableName("wb_cluster_automation_state")}
         SET review_status = $4
       WHERE advert_id = $1 AND nm_id = $2 AND normalized_cluster_name = $3`,
      [advertId, nmId, normalizedClusterName, status],
    );
  }

  /** Точечно проставить роль override (белый/чёрный) одному кластеру — для исхода ревью. */
  async setSingleClusterOverride(
    advertId: number,
    nmId: number,
    normalizedClusterName: string,
    clusterName: string,
    role: { isProtected: boolean; isBlacklisted: boolean },
  ): Promise<void> {
    await this.ensureSchemaOrThrow();
    await this.getPool().query(
      `INSERT INTO ${this.tableName("wb_cluster_automation_override")}
         (advert_id, nm_id, normalized_cluster_name, cluster_name, is_protected, is_blacklisted, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (advert_id, nm_id, normalized_cluster_name) DO UPDATE SET
         is_protected = EXCLUDED.is_protected,
         is_blacklisted = EXCLUDED.is_blacklisted,
         cluster_name = EXCLUDED.cluster_name,
         updated_at = NOW()`,
      [advertId, nmId, normalizedClusterName, clusterName, role.isProtected, role.isBlacklisted],
    );
  }

  /** Роли override (белый/чёрный список) одним запросом — для движка. */
  async getClusterOverrideRoles(
    advertId: number,
    nmId: number,
  ): Promise<{ protectedNames: Set<string>; blacklistedNames: Set<string> }> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      normalized_cluster_name: string;
      is_protected: boolean;
      is_blacklisted: boolean;
    }>(
      `SELECT normalized_cluster_name, is_protected, is_blacklisted
       FROM ${this.tableName("wb_cluster_automation_override")}
       WHERE advert_id = $1 AND nm_id = $2 AND (is_protected = TRUE OR is_blacklisted = TRUE)`,
      [advertId, nmId],
    );
    const protectedNames = new Set<string>();
    const blacklistedNames = new Set<string>();
    for (const r of result.rows) {
      if (r.is_blacklisted) blacklistedNames.add(r.normalized_cluster_name);
      else if (r.is_protected) protectedNames.add(r.normalized_cluster_name);
    }
    return { protectedNames, blacklistedNames };
  }

  /**
   * Read-model для модалки «Настройка фильтров»: управляемые кластеры (тот же предикат,
   * что у таблицы РК) + их текущее состояние/CPO движка и флаг защиты. Защищённые сверху.
   */
  async getClusterOverridePicker(
    advertId: number,
    nmId: number,
  ): Promise<ClusterOverridePickerRow[]> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      normalized_cluster_name: string;
      cluster_name: string;
      last_cpo: string | null;
      last_spend: string | null;
      state: ClusterAutomationStateValue | null;
      is_protected: boolean;
      is_blacklisted: boolean;
    }>(
      `SELECT
         c.normalized_cluster_name,
         MAX(c.cluster_name)                                AS cluster_name,
         MAX(s.last_cpo)::text                              AS last_cpo,
         MAX(s.last_spend)::text                            AS last_spend,
         MAX(s.state)                                       AS state,
         BOOL_OR(COALESCE(o.is_protected, FALSE))           AS is_protected,
         BOOL_OR(COALESCE(o.is_blacklisted, FALSE))         AS is_blacklisted
       FROM ${this.tableName("wb_clusters")} c
       LEFT JOIN ${this.tableName("wb_cluster_actions")} a
         ON a.advert_id = c.advert_id AND a.nm_id = c.nm_id
        AND a.normalized_cluster_name = c.normalized_cluster_name
       LEFT JOIN ${this.tableName("wb_cluster_automation_state")} s
         ON s.advert_id = c.advert_id AND s.nm_id = c.nm_id
        AND s.normalized_cluster_name = c.normalized_cluster_name
       LEFT JOIN ${this.tableName("wb_cluster_automation_override")} o
         ON o.advert_id = c.advert_id AND o.nm_id = c.nm_id
        AND o.normalized_cluster_name = c.normalized_cluster_name
       WHERE c.advert_id = $1 AND c.nm_id = $2
         AND (
           a.action_key IS NOT NULL
           OR c.source_kind IN ('active', 'excluded')
           OR c.is_active = FALSE
         )
       GROUP BY c.normalized_cluster_name
       ORDER BY BOOL_OR(COALESCE(o.is_protected, FALSE)) DESC, MAX(c.cluster_name) ASC`,
      [advertId, nmId],
    );
    return result.rows.map((r) => ({
      normalizedClusterName: r.normalized_cluster_name,
      clusterName: r.cluster_name,
      lastCpo: r.last_cpo != null ? Number(r.last_cpo) : null,
      lastSpend: r.last_spend != null ? Number(r.last_spend) : null,
      state: r.state,
      isProtected: r.is_protected,
      isBlacklisted: r.is_blacklisted,
    }));
  }

  /**
   * Полная замена наборов белого (protected) и чёрного (blacklisted) списков (advert, nm).
   * Транзакция: сбросить обе роли у всех, кого нет в новых наборах, затем проставить роли
   * переданным (idempotent). Чёрный приоритетнее: при пересечении кластер уходит в чёрный.
   */
  async setClusterFilters(
    advertId: number,
    nmId: number,
    input: { protected: ClusterOverrideItem[]; blacklisted: ClusterOverrideItem[] },
  ): Promise<void> {
    await this.ensureSchemaOrThrow();
    const table = this.tableName("wb_cluster_automation_override");
    // Чёрный приоритетнее белого: если кластер передан в обоих, считаем его только чёрным.
    const blacklistedKeys = new Set(input.blacklisted.map((i) => i.normalizedClusterName));
    const protectedItems = input.protected.filter(
      (i) => !blacklistedKeys.has(i.normalizedClusterName),
    );
    const roleByKey = new Map<string, { item: ClusterOverrideItem; isProtected: boolean; isBlacklisted: boolean }>();
    for (const item of protectedItems) {
      roleByKey.set(item.normalizedClusterName, { item, isProtected: true, isBlacklisted: false });
    }
    for (const item of input.blacklisted) {
      roleByKey.set(item.normalizedClusterName, { item, isProtected: false, isBlacklisted: true });
    }
    const keep = [...roleByKey.keys()];

    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN");
      // Сбросить роли у всех, кого нет в новых наборах.
      await client.query(
        `UPDATE ${table} SET is_protected = FALSE, is_blacklisted = FALSE, updated_at = NOW()
         WHERE advert_id = $1 AND nm_id = $2
           AND (is_protected = TRUE OR is_blacklisted = TRUE)
           AND NOT (normalized_cluster_name = ANY($3::text[]))`,
        [advertId, nmId, keep],
      );
      for (const { item, isProtected, isBlacklisted } of roleByKey.values()) {
        await client.query(
          `INSERT INTO ${table}
             (advert_id, nm_id, normalized_cluster_name, cluster_name, is_protected, is_blacklisted, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (advert_id, nm_id, normalized_cluster_name) DO UPDATE SET
             is_protected = EXCLUDED.is_protected,
             is_blacklisted = EXCLUDED.is_blacklisted,
             cluster_name = EXCLUDED.cluster_name,
             updated_at = NOW()`,
          [advertId, nmId, item.normalizedClusterName, item.clusterName, isProtected, isBlacklisted],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
