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
  /** Σ рекламных показов за 30 дней — реальный знаменатель CR (не крошечный накопитель). */
  views: number;
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
  /** Придержан регулятором дневного ДРР (excluded_drr); правило v2 уважает этот флаг. */
  drrHeld: boolean;
  /** Этап 2: CR показ→заказа (доля) по накопителям текущей корзины; null если не считалось. */
  lastCr: number | null;
  /** Этап 2: потолок ставки CPM (Макс СРО × 1000 × CR); null если не считалось. */
  lastBidCap: number | null;
  /** Этап 3: последняя замеренная позиция (с рекламой); null — не найдена/не зондировалось. */
  lastPosition: number | null;
  /** Этап 3: желаемая ставка движка (₽); null — не считалось. */
  lastDesiredBid: number | null;
  /** Этап 3: причина решения (up/down/frozen/at_cap/at_min/unprofitable). */
  lastBidReason: string | null;
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
   * Сколько новых кластеров на ручной проверке по каждому товару (для бейджа в колонке
   * «Авто» таблицы товаров). Считаем pending-строки состояния у товаров, где есть хотя бы
   * одна включённая (preview/live) кампания. nm_id → pendingCount.
   */
  async getProductPendingCounts(): Promise<{ nmId: number; pendingCount: number }[]> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{ nm_id: string; pending_count: string }>(
      `SELECT s.nm_id::text, COUNT(*)::text AS pending_count
       FROM ${this.tableName("wb_cluster_automation_state")} s
       WHERE s.review_status = 'pending'
         AND EXISTS (
           SELECT 1 FROM ${this.tableName("wb_campaign_automation")} a
           WHERE a.advert_id = s.advert_id AND a.nm_id = s.nm_id
             AND a.mode IN ('preview', 'live')
         )
       GROUP BY s.nm_id`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      pendingCount: Number(r.pending_count),
    }));
  }

  /**
   * Кластеры на ручной проверке (review_status='pending') кампании, обогащённые данными для
   * модалки ревью: предв. CPO (last_cpo), частота запроса (Σ monthly_frequency — для одной
   * кампании дублей нет, UNIQUE по nm+advert+query) и JAM-заказы (тот же jam-CTE, что в CPO).
   */
  async getPendingClusters(
    advertId: number,
    nmId: number,
  ): Promise<{
    normalizedClusterName: string;
    lastCpo: number | null;
    frequency: number | null;
    jamOrders: number | null;
    suggestedReviewAction: "approve" | "blacklist" | null;
  }[]> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      normalized_cluster_name: string;
      last_cpo: string | null;
      frequency: string | null;
      orders_jam: string | null;
      suggested_review_action: "approve" | "blacklist" | null;
    }>(
      `
      WITH jam AS (
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
      freq AS (
        SELECT normalized_cluster_name, NULLIF(SUM(monthly_frequency), 0) AS frequency
        FROM ${this.tableName("wb_cabinet_cluster_queries")}
        WHERE advert_id = $1 AND nm_id = $2
        GROUP BY normalized_cluster_name
      )
      SELECT st.normalized_cluster_name,
             st.last_cpo::text         AS last_cpo,
             freq.frequency::text      AS frequency,
             jam.orders_jam::text      AS orders_jam,
             st.suggested_review_action AS suggested_review_action
      FROM ${this.tableName("wb_cluster_automation_state")} st
      LEFT JOIN freq ON freq.normalized_cluster_name = st.normalized_cluster_name
      LEFT JOIN jam  ON jam.ncn = st.normalized_cluster_name
      WHERE st.advert_id = $1 AND st.nm_id = $2 AND st.review_status = 'pending'
      ORDER BY freq.frequency DESC NULLS LAST, st.normalized_cluster_name
      `,
      [advertId, nmId],
    );
    return result.rows.map((r) => ({
      normalizedClusterName: r.normalized_cluster_name,
      lastCpo: r.last_cpo != null ? Number(r.last_cpo) : null,
      frequency: r.frequency != null ? Number(r.frequency) : null,
      jamOrders: r.orders_jam != null ? Number(r.orders_jam) : null,
      suggestedReviewAction: r.suggested_review_action,
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
      drr_held: boolean;
      last_cr: string | null;
      last_bid_cap: string | null;
      last_position: number | null;
      last_desired_bid: string | null;
      last_bid_reason: string | null;
    }>(
      `SELECT normalized_cluster_name, state, manual_protected, last_cpo::text, last_decision, review_status, drr_held, last_cr::text, last_bid_cap::text, last_position, last_desired_bid::text, last_bid_reason
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
      drrHeld: r.drr_held,
      lastCr: r.last_cr != null ? Number(r.last_cr) : null,
      lastBidCap: r.last_bid_cap != null ? Number(r.last_bid_cap) : null,
      lastPosition: r.last_position,
      lastDesiredBid: r.last_desired_bid != null ? Number(r.last_desired_bid) : null,
      lastBidReason: r.last_bid_reason,
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
      drr_held: boolean;
      last_cr: string | null;
      last_bid_cap: string | null;
      last_position: number | null;
      last_desired_bid: string | null;
      last_bid_reason: string | null;
    }>(
      `SELECT s.normalized_cluster_name, s.state, s.manual_protected, s.last_cpo::text, s.last_decision, s.review_status, s.drr_held, s.last_cr::text, s.last_bid_cap::text, s.last_position, s.last_desired_bid::text, s.last_bid_reason
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
      drrHeld: r.drr_held,
      lastCr: r.last_cr != null ? Number(r.last_cr) : null,
      lastBidCap: r.last_bid_cap != null ? Number(r.last_bid_cap) : null,
      lastPosition: r.last_position,
      lastDesiredBid: r.last_desired_bid != null ? Number(r.last_desired_bid) : null,
      lastBidReason: r.last_bid_reason,
    }));
  }

  /**
   * Батч-апсерт состояний кластеров одним multi-row INSERT (вместо N последовательных
   * запросов). Критично для отзывчивости: при первом включении preview движок пишет
   * состояние ~всех кластеров кампании — серийный цикл давал десятки round-trip и панель
   * висела на «…». Один запрос на всю пачку.
   */
  async upsertClusterAutomationStates(
    rows: {
      advertId: number;
      nmId: number;
      normalizedClusterName: string;
      state: ClusterAutomationStateValue;
      manualProtected: boolean;
      lastCpo: number | null;
      lastSpend: number | null;
      lastDecision: string | null;
      reviewStatus: ClusterReviewStatus;
      /** ADVISORY-рекомендация мусор-фильтра для pending; NULL для не-pending. */
      suggestedReviewAction: "approve" | "blacklist" | null;
      /** Этап 2: CR показ→заказа (доля) и потолок ставки CPM; NULL если не считалось. */
      lastCr: number | null;
      lastBidCap: number | null;
    }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.ensureSchemaOrThrow();
    const cols = 12;
    const placeholders = rows
      .map(
        (_, i) =>
          `($${i * cols + 1}, $${i * cols + 2}, $${i * cols + 3}, $${i * cols + 4}, $${i * cols + 5}, $${i * cols + 6}, $${i * cols + 7}, $${i * cols + 8}, $${i * cols + 9}, $${i * cols + 10}, $${i * cols + 11}, $${i * cols + 12}, NOW())`,
      )
      .join(", ");
    const values = rows.flatMap((r) => [
      r.advertId,
      r.nmId,
      r.normalizedClusterName,
      r.state,
      r.manualProtected,
      r.lastCpo,
      r.lastSpend,
      r.lastDecision,
      r.reviewStatus,
      r.suggestedReviewAction,
      r.lastCr,
      r.lastBidCap,
    ]);
    await this.getPool().query(
      `INSERT INTO ${this.tableName("wb_cluster_automation_state")}
         (advert_id, nm_id, normalized_cluster_name, state, manual_protected, last_cpo, last_spend, last_decision, review_status, suggested_review_action, last_cr, last_bid_cap, decided_at)
       VALUES ${placeholders}
       ON CONFLICT (advert_id, nm_id, normalized_cluster_name) DO UPDATE SET
         state = EXCLUDED.state,
         manual_protected = EXCLUDED.manual_protected,
         last_cpo = EXCLUDED.last_cpo,
         last_spend = EXCLUDED.last_spend,
         last_decision = EXCLUDED.last_decision,
         review_status = EXCLUDED.review_status,
         suggested_review_action = EXCLUDED.suggested_review_action,
         last_cr = EXCLUDED.last_cr,
         last_bid_cap = EXCLUDED.last_bid_cap,
         decided_at = NOW()`,
      values,
    );
  }
}
