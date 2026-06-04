import {
  WbClustersRepositoryAutomationOverrides,
  type ClusterAutomationStateValue,
  type ClusterReviewStatus,
} from "./wb-clusters.repository.automation-overrides";

// Типы override/модерации живут в базовом звене automation-overrides; реэкспортим,
// чтобы внешние потребители (сервис, repository) импортировали их отсюда как раньше.
export type {
  ClusterAutomationStateValue,
  ClusterReviewStatus,
  ClusterOverridePickerRow,
  ClusterOverrideItem,
} from "./wb-clusters.repository.automation-overrides";

export type AutomationMode = "off" | "preview" | "live";

/** Вход для расчёта CPO кластера за окно (скользящие 30 дней). */
export interface ClusterCpoInput {
  normalizedClusterName: string;
  clusterName: string;
  /** Σ расход РК за 30 дней. */
  spend: number;
  /** Σ заказанных товаров (shks) РК за 30 дней — основной знаменатель CPO (как колонка таблицы). */
  shks: number | null;
  /** Σ заказов РК за 30 дней (fallback, если shks нет). */
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
  reviewStatus: ClusterReviewStatus;
}

/**
 * Доступ к данным автоматизации управления кластерами по CPO. Звено цепочки репозитория
 * (общий pool/tableName/ensureSchema). Таблицы: wb_campaign_automation (режим на
 * advert+nm) и wb_cluster_automation_state (состояние движка по кластеру).
 */
export abstract class WbClustersRepositoryAutomation extends WbClustersRepositoryAutomationOverrides {
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
   * Сводный статус автоматизации по каждому товару (для колонки в таблице товаров):
   * только товары, где есть хотя бы одна включённая кампания. Режим товара —
   * «сильнейший» среди его кампаний: live > preview. campaignsWithAutomation — сколько
   * кампаний товара под автоматизацией.
   */
  async getProductAutomationModes(): Promise<
    { nmId: number; mode: AutomationMode; campaignsWithAutomation: number }[]
  > {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      nm_id: string;
      mode: AutomationMode;
      campaigns_with_automation: string;
    }>(
      `SELECT nm_id::text,
              CASE WHEN BOOL_OR(mode = 'live') THEN 'live' ELSE 'preview' END AS mode,
              COUNT(*)::text AS campaigns_with_automation
       FROM ${this.tableName("wb_campaign_automation")}
       WHERE mode IN ('preview', 'live')
       GROUP BY nm_id`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      mode: r.mode,
      campaignsWithAutomation: Number(r.campaigns_with_automation),
    }));
  }

  /**
   * Кампании товара (для per-product автоматизации из таблицы товаров): все РК, в которых
   * участвует nmId. Имя — для подписи в модалке. Множество совпадает с колонкой «РК»
   * таблицы товаров (источник тот же — wb_campaign_products).
   */
  async getProductCampaignAdvertIds(
    nmId: number,
  ): Promise<{ advertId: number; name: string | null }[]> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{ advert_id: string; name: string | null }>(
      `SELECT cp.advert_id::text, c.name
       FROM ${this.tableName("wb_campaign_products")} cp
       JOIN ${this.tableName("wb_campaigns")} c ON c.advert_id = cp.advert_id
       WHERE cp.nm_id = $1
       ORDER BY c.advert_id`,
      [nmId],
    );
    return result.rows.map((r) => ({ advertId: Number(r.advert_id), name: r.name }));
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
      shks: string | null;
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
               SUM(shks)                AS shks,
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
        stats.shks,
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
      shks: r.shks != null ? Number(r.shks) : null,
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
      review_status: ClusterReviewStatus;
    }>(
      `SELECT normalized_cluster_name, state, manual_protected, last_cpo::text, last_decision, review_status
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
      reviewStatus: r.review_status,
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
      review_status: ClusterReviewStatus;
    }>(
      `SELECT s.normalized_cluster_name, s.state, s.manual_protected, s.last_cpo::text, s.last_decision, s.review_status
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
      reviewStatus: r.review_status,
    }));
  }

  async upsertClusterAutomationState(input: {
    advertId: number;
    nmId: number;
    normalizedClusterName: string;
    state: ClusterAutomationStateValue;
    manualProtected: boolean;
    lastCpo: number | null;
    lastSpend: number | null;
    lastDecision: string | null;
    reviewStatus: ClusterReviewStatus;
  }): Promise<void> {
    await this.ensureSchemaOrThrow();
    await this.getPool().query(
      `INSERT INTO ${this.tableName("wb_cluster_automation_state")}
         (advert_id, nm_id, normalized_cluster_name, state, manual_protected, last_cpo, last_spend, last_decision, review_status, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (advert_id, nm_id, normalized_cluster_name) DO UPDATE SET
         state = EXCLUDED.state,
         manual_protected = EXCLUDED.manual_protected,
         last_cpo = EXCLUDED.last_cpo,
         last_spend = EXCLUDED.last_spend,
         last_decision = EXCLUDED.last_decision,
         review_status = EXCLUDED.review_status,
         decided_at = NOW()`,
      [
        input.advertId,
        input.nmId,
        input.normalizedClusterName,
        input.state,
        input.manualProtected,
        input.lastCpo,
        input.lastSpend,
        input.lastDecision,
        input.reviewStatus,
      ],
    );
  }
}
