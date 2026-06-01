import { WbClustersRepositoryMarginSnapshot } from "./wb-clusters.repository.margin-snapshot";

export type AutomationMode = "off" | "preview" | "live";
export type ClusterAutomationStateValue =
  | "active"
  | "excluded_high"
  | "dropped"
  | "manual_protected"
  | "protected"
  | "blacklisted";

/** Строка пикера «Настройка фильтров»: кластер + его состояние и роли (белый/чёрный). */
export interface ClusterOverridePickerRow {
  normalizedClusterName: string;
  clusterName: string;
  lastCpo: number | null;
  state: ClusterAutomationStateValue | null;
  isProtected: boolean;
  isBlacklisted: boolean;
}

/** Один override-элемент при сохранении набора (имя + отображаемое имя). */
export interface ClusterOverrideItem {
  normalizedClusterName: string;
  clusterName: string;
}

/** Вход для расчёта CPO кластера за окно (скользящие 30 дней). */
export interface ClusterCpoInput {
  normalizedClusterName: string;
  clusterName: string;
  /** Σ расход РК за 30 дней. */
  spend: number;
  /** Σ заказов РК за 30 дней. */
  ordersRk: number;
  /** Σ JAM-заказов (orders_current) за 30 дней. */
  ordersJam: number;
  /** Текущее состояние на WB: 'active' | 'excluded' | прочее (из синка). */
  currentSourceKind: string | null;
  /** Дата последней строки статистики (для свежести «прошёл месяц»). */
  lastStatDate: string | null;
}

export interface ClusterAutomationStateRow {
  normalizedClusterName: string;
  state: ClusterAutomationStateValue;
  manualProtected: boolean;
  lastCpo: number | null;
  lastDecision: string | null;
}

/**
 * Доступ к данным автоматизации управления кластерами по CPO. Звено цепочки репозитория
 * (общий pool/tableName/ensureSchema). Таблицы: wb_campaign_automation (режим на
 * advert+nm) и wb_cluster_automation_state (состояние движка по кластеру).
 */
export abstract class WbClustersRepositoryAutomation extends WbClustersRepositoryMarginSnapshot {
  async getAutomationMode(advertId: number, nmId: number): Promise<AutomationMode> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{ mode: AutomationMode }>(
      `SELECT mode FROM ${this.tableName("wb_campaign_automation")}
       WHERE advert_id = $1 AND nm_id = $2`,
      [advertId, nmId],
    );
    return result.rows[0]?.mode ?? "off";
  }

  async setAutomationMode(advertId: number, nmId: number, mode: AutomationMode): Promise<void> {
    await this.ensureSchemaOrThrow();
    await this.getPool().query(
      `INSERT INTO ${this.tableName("wb_campaign_automation")} (advert_id, nm_id, mode, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (advert_id, nm_id) DO UPDATE SET mode = EXCLUDED.mode, updated_at = NOW()`,
      [advertId, nmId, mode],
    );
  }

  /** Все включённые автоматизации (preview/live) — для крон-обхода. */
  async listEnabledAutomations(): Promise<
    { advertId: number; nmId: number; mode: AutomationMode }[]
  > {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{ advert_id: string; nm_id: string; mode: AutomationMode }>(
      `SELECT advert_id::text, nm_id::text, mode
       FROM ${this.tableName("wb_campaign_automation")}
       WHERE mode IN ('preview', 'live')`,
    );
    return result.rows.map((r) => ({
      advertId: Number(r.advert_id),
      nmId: Number(r.nm_id),
      mode: r.mode,
    }));
  }

  /**
   * Входы для CPO по каждому кластеру (advert, nm) за скользящие 30 дней: расход и заказы
   * РК, JAM-заказы, текущее состояние на WB (с overlay действий) и дата последней статистики.
   */
  async getClusterCpoInputs(advertId: number, nmId: number): Promise<ClusterCpoInput[]> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      normalized_cluster_name: string;
      cluster_name: string;
      spend: string | null;
      orders_rk: string | null;
      orders_jam: string | null;
      source_kind: string | null;
      last_stat_date: string | null;
    }>(
      `
      WITH stats AS (
        SELECT normalized_cluster_name,
               MAX(cluster_name)        AS cluster_name,
               SUM(spend)               AS spend,
               SUM(orders)              AS orders_rk,
               MAX(stat_date)::text     AS last_stat_date
        FROM ${this.tableName("wb_cluster_daily_stats")}
        WHERE advert_id = $1 AND nm_id = $2
          AND stat_date >= (CURRENT_DATE - INTERVAL '30 days')
        GROUP BY normalized_cluster_name
      ),
      jam AS (
        SELECT LOWER(TRIM(cq.cluster_name)) AS ncn,
               SUM(r.orders_current)        AS orders_jam
        FROM ${this.tableName("wb_cabinet_cluster_queries")} cq
        JOIN ${this.tableName("wb_product_search_text_range_snapshots")} s
          ON s.nm_id = $2 AND s.start_date = s.end_date
         AND s.start_date >= (CURRENT_DATE - INTERVAL '30 days')
        JOIN ${this.tableName("wb_product_search_text_range_rows")} r
          ON r.snapshot_key = s.snapshot_key
         AND r.normalized_query_text = cq.normalized_query_text
        WHERE cq.advert_id = $1 AND cq.nm_id = $2
        GROUP BY LOWER(TRIM(cq.cluster_name))
      ),
      cur AS (
        SELECT c.normalized_cluster_name,
               MAX(c.cluster_name) AS cluster_name,
               -- overlay действия (desired_is_active) поверх синкнутого source_kind
               (CASE
                  WHEN BOOL_OR(a.action_key IS NOT NULL AND a.desired_is_active) THEN 'active'
                  WHEN BOOL_OR(a.action_key IS NOT NULL AND NOT a.desired_is_active) THEN 'excluded'
                  ELSE MAX(c.source_kind)
                END) AS source_kind
        FROM ${this.tableName("wb_clusters")} c
        LEFT JOIN ${this.tableName("wb_cluster_actions")} a
          ON a.advert_id = c.advert_id AND a.nm_id = c.nm_id
         AND a.normalized_cluster_name = c.normalized_cluster_name
        WHERE c.advert_id = $1 AND c.nm_id = $2
          -- Только «управляемые» кластеры — тот же предикат, что у таблицы РК
          -- (workspace-fast-sql), иначе автоматика считает фантомные строки
          -- wb_clusters и «выбыло» не сходится с «Все N».
          AND (
            a.action_key IS NOT NULL
            OR c.source_kind IN ('active', 'excluded')
            OR c.is_active = FALSE
          )
        GROUP BY c.normalized_cluster_name
      )
      SELECT
        cur.normalized_cluster_name,
        COALESCE(cur.cluster_name, stats.cluster_name, cur.normalized_cluster_name) AS cluster_name,
        stats.spend,
        stats.orders_rk,
        jam.orders_jam,
        cur.source_kind,
        stats.last_stat_date
      FROM cur
      LEFT JOIN stats ON stats.normalized_cluster_name = cur.normalized_cluster_name
      LEFT JOIN jam   ON jam.ncn = cur.normalized_cluster_name
      `,
      [advertId, nmId],
    );
    const num = (v: string | null): number => (v != null ? Number(v) : 0);
    return result.rows.map((r) => ({
      normalizedClusterName: r.normalized_cluster_name,
      clusterName: r.cluster_name,
      spend: num(r.spend),
      ordersRk: num(r.orders_rk),
      ordersJam: num(r.orders_jam),
      currentSourceKind: r.source_kind,
      lastStatDate: r.last_stat_date,
    }));
  }

  async getClusterAutomationStates(
    advertId: number,
    nmId: number,
  ): Promise<ClusterAutomationStateRow[]> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      normalized_cluster_name: string;
      state: ClusterAutomationStateValue;
      manual_protected: boolean;
      last_cpo: string | null;
      last_decision: string | null;
    }>(
      `SELECT normalized_cluster_name, state, manual_protected, last_cpo::text, last_decision
       FROM ${this.tableName("wb_cluster_automation_state")}
       WHERE advert_id = $1 AND nm_id = $2`,
      [advertId, nmId],
    );
    return result.rows.map((r) => ({
      normalizedClusterName: r.normalized_cluster_name,
      state: r.state,
      manualProtected: r.manual_protected,
      lastCpo: r.last_cpo != null ? Number(r.last_cpo) : null,
      lastDecision: r.last_decision,
    }));
  }

  /**
   * Состояния автоматики только для «управляемых» сейчас кластеров (тот же предикат,
   * что у таблицы РК). Таблица wb_cluster_automation_state копит строки и никогда не
   * чистит исторические/фантомные кластеры — без этого фильтра счётчики на дисплее
   * («актив/искл/выбыло») не сходятся с «Все N». Для дисплея, не для оценки.
   */
  async getManagedClusterAutomationStates(
    advertId: number,
    nmId: number,
  ): Promise<ClusterAutomationStateRow[]> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      normalized_cluster_name: string;
      state: ClusterAutomationStateValue;
      manual_protected: boolean;
      last_cpo: string | null;
      last_decision: string | null;
    }>(
      `SELECT s.normalized_cluster_name, s.state, s.manual_protected, s.last_cpo::text, s.last_decision
       FROM ${this.tableName("wb_cluster_automation_state")} s
       WHERE s.advert_id = $1 AND s.nm_id = $2
         AND EXISTS (
           SELECT 1
           FROM ${this.tableName("wb_clusters")} c
           LEFT JOIN ${this.tableName("wb_cluster_actions")} a
             ON a.advert_id = c.advert_id AND a.nm_id = c.nm_id
            AND a.normalized_cluster_name = c.normalized_cluster_name
           WHERE c.advert_id = s.advert_id AND c.nm_id = s.nm_id
             AND c.normalized_cluster_name = s.normalized_cluster_name
             AND (
               a.action_key IS NOT NULL
               OR c.source_kind IN ('active', 'excluded')
               OR c.is_active = FALSE
             )
         )`,
      [advertId, nmId],
    );
    return result.rows.map((r) => ({
      normalizedClusterName: r.normalized_cluster_name,
      state: r.state,
      manualProtected: r.manual_protected,
      lastCpo: r.last_cpo != null ? Number(r.last_cpo) : null,
      lastDecision: r.last_decision,
    }));
  }

  async upsertClusterAutomationState(input: {
    advertId: number;
    nmId: number;
    normalizedClusterName: string;
    state: ClusterAutomationStateValue;
    manualProtected: boolean;
    lastCpo: number | null;
    lastDecision: string | null;
  }): Promise<void> {
    await this.ensureSchemaOrThrow();
    await this.getPool().query(
      `INSERT INTO ${this.tableName("wb_cluster_automation_state")}
         (advert_id, nm_id, normalized_cluster_name, state, manual_protected, last_cpo, last_decision, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (advert_id, nm_id, normalized_cluster_name) DO UPDATE SET
         state = EXCLUDED.state,
         manual_protected = EXCLUDED.manual_protected,
         last_cpo = EXCLUDED.last_cpo,
         last_decision = EXCLUDED.last_decision,
         decided_at = NOW()`,
      [
        input.advertId,
        input.nmId,
        input.normalizedClusterName,
        input.state,
        input.manualProtected,
        input.lastCpo,
        input.lastDecision,
      ],
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
      state: ClusterAutomationStateValue | null;
      is_protected: boolean;
      is_blacklisted: boolean;
    }>(
      `SELECT
         c.normalized_cluster_name,
         MAX(c.cluster_name)                                AS cluster_name,
         MAX(s.last_cpo)::text                              AS last_cpo,
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
