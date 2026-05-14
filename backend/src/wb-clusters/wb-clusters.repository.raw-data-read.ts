import { WbClustersRepositoryWorkspaceSnapshotStorage } from "./wb-clusters.repository.workspace-snapshot-storage";

export interface RawJamRow {
  snapshotKey: string;
  nmId: number;
  startDate: string;
  endDate: string;
  queryText: string;
  normalizedQueryText: string;
  frequency: number | null;
  weekFrequency: number | null;
  avgPositionCurrent: number | null;
  avgPositionDynamics: number | null;
  ordersCurrent: number | null;
  ordersDynamics: number | null;
  openCardCurrent: number | null;
  openCardDynamics: number | null;
  addToCartCurrent: number | null;
  addToCartDynamics: number | null;
  openToCartCurrent: number | null;
  openToCartDynamics: number | null;
  syncedAt: string | null;
}

export interface RawCampaignRow {
  advertId: number;
  campaignType: number | null;
  campaignStatus: number | null;
  paymentType: string | null;
  bidType: string | null;
  currency: string | null;
  name: string | null;
  changeTime: string | null;
  createdAtWb: string | null;
  startedAtWb: string | null;
  updatedAtWb: string | null;
  syncedAt: string | null;
}

export interface RawCampaignProductRow {
  advertId: number;
  nmId: number;
  campaignName: string | null;
  campaignType: number | null;
  campaignStatus: number | null;
  subjectId: number | null;
  subjectName: string | null;
  searchBid: number | null;
  minSearchBid: number | null;
  syncedAt: string | null;
}

export interface RawSyncRunRow {
  id: string;
  trigger: string | null;
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  campaignsSeen: number | null;
  campaignsSynced: number | null;
  productsSeen: number | null;
  clustersUpserted: number | null;
  statsRowsUpserted: number | null;
  warningCount: number | null;
  hasPartialFailure: boolean | null;
  errorMessage: string | null;
  createdAt: string | null;
}

export interface RawClusterStatRow {
  clusterKey: string;
  advertId: number;
  nmId: number;
  clusterName: string | null;
  sourceKind: string | null;
  isActive: boolean | null;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  addToCart: number | null;
  ctr: number | null;
  avgPosition: number | null;
  cpc: number | null;
  cpm: number | null;
  spend: number | null;
  currency: string | null;
  syncedAt: string | null;
}

export interface RawDailyStatRow {
  dailyStatKey: string;
  advertId: number;
  nmId: number;
  statDate: string;
  clusterName: string | null;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  addToCart: number | null;
  shks: number | null;
  ctr: number | null;
  avgPosition: number | null;
  cpc: number | null;
  cpm: number | null;
  spend: number | null;
  currency: string | null;
  syncedAt: string | null;
}

export interface RawMinusPhraseRow {
  advertId: number;
  nmId: number;
  phrase: string;
  normalizedPhrase: string;
  syncedAt: string | null;
}

export interface RawQueryFrequencyRow {
  normalizedQueryText: string;
  queryText: string;
  monthlyFrequency: number | null;
  reportType: string | null;
  reportStartDate: string | null;
  reportEndDate: string | null;
  syncedAt: string | null;
}

export abstract class WbClustersRepositoryRawDataRead extends WbClustersRepositoryWorkspaceSnapshotStorage {
  async getRawJamRows(opts: {
    nmId?: number;
    dateFrom?: string;
    dateTo?: string;
    /** undefined = no LIMIT applied (return all matching rows) */
    limit?: number;
  }): Promise<RawJamRow[]> {
    if (!this.isConfigured()) return [];
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.nmId != null) {
      params.push(opts.nmId);
      conditions.push(`s.nm_id = $${params.length}`);
    }
    if (opts.dateFrom) {
      params.push(opts.dateFrom);
      conditions.push(`s.start_date >= $${params.length}`);
    }
    if (opts.dateTo) {
      params.push(opts.dateTo);
      conditions.push(`s.end_date <= $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    let limitClause = "";
    if (opts.limit != null) {
      params.push(opts.limit);
      limitClause = `LIMIT $${params.length}`;
    }

    const result = await pool.query<{
      snapshot_key: string;
      nm_id: string;
      start_date: string;
      end_date: string;
      query_text: string;
      normalized_query_text: string;
      frequency: string | null;
      week_frequency: string | null;
      avg_position_current: string | null;
      avg_position_dynamics: string | null;
      orders_current: string | null;
      orders_dynamics: string | null;
      open_card_current: string | null;
      open_card_dynamics: string | null;
      add_to_cart_current: string | null;
      add_to_cart_dynamics: string | null;
      open_to_cart_current: string | null;
      open_to_cart_dynamics: string | null;
      synced_at: string | null;
    }>(
      `SELECT
        r.snapshot_key,
        s.nm_id::text AS nm_id,
        s.start_date::text AS start_date,
        s.end_date::text AS end_date,
        r.query_text,
        r.normalized_query_text,
        r.frequency::text AS frequency,
        r.week_frequency::text AS week_frequency,
        r.avg_position_current::text AS avg_position_current,
        r.avg_position_dynamics::text AS avg_position_dynamics,
        r.orders_current::text AS orders_current,
        r.orders_dynamics::text AS orders_dynamics,
        r.open_card_current::text AS open_card_current,
        r.open_card_dynamics::text AS open_card_dynamics,
        r.add_to_cart_current::text AS add_to_cart_current,
        r.add_to_cart_dynamics::text AS add_to_cart_dynamics,
        r.open_to_cart_current::text AS open_to_cart_current,
        r.open_to_cart_dynamics::text AS open_to_cart_dynamics,
        r.synced_at::text AS synced_at
      FROM ${this.tableName("wb_product_search_text_range_rows")} r
      JOIN ${this.tableName("wb_product_search_text_range_snapshots")} s
        ON s.snapshot_key = r.snapshot_key
      ${where}
      ORDER BY s.nm_id, s.start_date DESC, r.frequency DESC NULLS LAST
      ${limitClause}`,
      params,
    );

    return result.rows.map((row) => ({
      snapshotKey: row.snapshot_key,
      nmId: Number(row.nm_id),
      startDate: row.start_date,
      endDate: row.end_date,
      queryText: row.query_text,
      normalizedQueryText: row.normalized_query_text,
      frequency: this.toNullableNumber(row.frequency),
      weekFrequency: this.toNullableNumber(row.week_frequency),
      avgPositionCurrent: this.toNullableNumber(row.avg_position_current),
      avgPositionDynamics: this.toNullableNumber(row.avg_position_dynamics),
      ordersCurrent: this.toNullableNumber(row.orders_current),
      ordersDynamics: this.toNullableNumber(row.orders_dynamics),
      openCardCurrent: this.toNullableNumber(row.open_card_current),
      openCardDynamics: this.toNullableNumber(row.open_card_dynamics),
      addToCartCurrent: this.toNullableNumber(row.add_to_cart_current),
      addToCartDynamics: this.toNullableNumber(row.add_to_cart_dynamics),
      openToCartCurrent: this.toNullableNumber(row.open_to_cart_current),
      openToCartDynamics: this.toNullableNumber(row.open_to_cart_dynamics),
      syncedAt: row.synced_at,
    }));
  }

  async getRawCampaigns(limit: number): Promise<RawCampaignRow[]> {
    if (!this.isConfigured()) return [];
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    const result = await pool.query<{
      advert_id: string;
      campaign_type: string | null;
      campaign_status: string | null;
      payment_type: string | null;
      bid_type: string | null;
      currency: string | null;
      name: string | null;
      change_time: string | null;
      created_at_wb: string | null;
      started_at_wb: string | null;
      updated_at_wb: string | null;
      synced_at: string | null;
    }>(
      `SELECT
        advert_id::text,
        campaign_type::text,
        campaign_status::text,
        payment_type,
        bid_type,
        currency,
        name,
        change_time::text,
        created_at_wb::text,
        started_at_wb::text,
        updated_at_wb::text,
        synced_at::text
      FROM ${this.tableName("wb_campaigns")}
      ORDER BY advert_id DESC
      LIMIT $1`,
      [limit],
    );

    return result.rows.map((row) => ({
      advertId: Number(row.advert_id),
      campaignType: this.toNullableNumber(row.campaign_type),
      campaignStatus: this.toNullableNumber(row.campaign_status),
      paymentType: row.payment_type,
      bidType: row.bid_type,
      currency: row.currency,
      name: row.name,
      changeTime: row.change_time,
      createdAtWb: row.created_at_wb,
      startedAtWb: row.started_at_wb,
      updatedAtWb: row.updated_at_wb,
      syncedAt: row.synced_at,
    }));
  }

  async getRawCampaignProducts(opts: {
    nmId?: number;
    limit: number;
  }): Promise<RawCampaignProductRow[]> {
    if (!this.isConfigured()) return [];
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    const params: unknown[] = [opts.limit];
    const where = opts.nmId != null ? `WHERE cp.nm_id = $2` : "";
    if (opts.nmId != null) params.push(opts.nmId);

    const result = await pool.query<{
      advert_id: string;
      nm_id: string;
      campaign_name: string | null;
      campaign_type: string | null;
      campaign_status: string | null;
      subject_id: string | null;
      subject_name: string | null;
      search_bid: string | null;
      min_search_bid: string | null;
      synced_at: string | null;
    }>(
      `SELECT
        cp.advert_id::text,
        cp.nm_id::text,
        c.name AS campaign_name,
        c.campaign_type::text,
        c.campaign_status::text,
        cp.subject_id::text,
        cp.subject_name,
        cp.search_bid::text,
        cp.min_search_bid::text,
        cp.synced_at::text
      FROM ${this.tableName("wb_campaign_products")} cp
      LEFT JOIN ${this.tableName("wb_campaigns")} c ON c.advert_id = cp.advert_id
      ${where}
      ORDER BY cp.advert_id DESC, cp.nm_id
      LIMIT $1`,
      params,
    );

    return result.rows.map((row) => ({
      advertId: Number(row.advert_id),
      nmId: Number(row.nm_id),
      campaignName: row.campaign_name,
      campaignType: this.toNullableNumber(row.campaign_type),
      campaignStatus: this.toNullableNumber(row.campaign_status),
      subjectId: this.toNullableNumber(row.subject_id),
      subjectName: row.subject_name,
      searchBid: this.toNullableNumber(row.search_bid),
      minSearchBid: this.toNullableNumber(row.min_search_bid),
      syncedAt: row.synced_at,
    }));
  }

  async getRawSyncRuns(limit: number): Promise<RawSyncRunRow[]> {
    if (!this.isConfigured()) return [];
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    const result = await pool.query<{
      id: string;
      trigger: string | null;
      status: string | null;
      started_at: string | null;
      finished_at: string | null;
      campaigns_seen: string | null;
      campaigns_synced: string | null;
      products_seen: string | null;
      clusters_upserted: string | null;
      stats_rows_upserted: string | null;
      warning_count: string | null;
      has_partial_failure: boolean | null;
      error_message: string | null;
      created_at: string | null;
    }>(
      `SELECT
        id,
        trigger,
        status,
        started_at::text,
        finished_at::text,
        campaigns_seen::text,
        campaigns_synced::text,
        products_seen::text,
        clusters_upserted::text,
        stats_rows_upserted::text,
        warning_count::text,
        has_partial_failure,
        error_message,
        created_at::text
      FROM ${this.tableName("wb_cluster_sync_runs")}
      ORDER BY started_at DESC
      LIMIT $1`,
      [limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      trigger: row.trigger,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      campaignsSeen: this.toNullableNumber(row.campaigns_seen),
      campaignsSynced: this.toNullableNumber(row.campaigns_synced),
      productsSeen: this.toNullableNumber(row.products_seen),
      clustersUpserted: this.toNullableNumber(row.clusters_upserted),
      statsRowsUpserted: this.toNullableNumber(row.stats_rows_upserted),
      warningCount: this.toNullableNumber(row.warning_count),
      hasPartialFailure: row.has_partial_failure,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    }));
  }

  async getRawClusterStats(opts: {
    nmId?: number;
    limit: number;
  }): Promise<RawClusterStatRow[]> {
    if (!this.isConfigured()) return [];
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    const params: unknown[] = [opts.limit];
    const where = opts.nmId != null ? `WHERE cl.nm_id = $2` : "";
    if (opts.nmId != null) params.push(opts.nmId);

    const result = await pool.query<{
      cluster_key: string;
      advert_id: string;
      nm_id: string;
      cluster_name: string | null;
      source_kind: string | null;
      is_active: boolean | null;
      views: string | null;
      clicks: string | null;
      orders: string | null;
      add_to_cart: string | null;
      ctr: string | null;
      avg_position: string | null;
      cpc: string | null;
      cpm: string | null;
      spend: string | null;
      currency: string | null;
      synced_at: string | null;
    }>(
      `SELECT
        cl.cluster_key,
        cl.advert_id::text,
        cl.nm_id::text,
        cl.cluster_name,
        cl.source_kind,
        cl.is_active,
        cs.views::text,
        cs.clicks::text,
        cs.orders::text,
        cs.add_to_cart::text,
        cs.ctr::text,
        cs.avg_position::text,
        cs.cpc::text,
        cs.cpm::text,
        cs.spend::text,
        cs.currency,
        cl.synced_at::text
      FROM ${this.tableName("wb_clusters")} cl
      LEFT JOIN ${this.tableName("wb_cluster_stats")} cs ON cs.cluster_key = cl.cluster_key
      ${where}
      ORDER BY cl.advert_id DESC, cl.nm_id, cl.cluster_name
      LIMIT $1`,
      params,
    );

    return result.rows.map((row) => ({
      clusterKey: row.cluster_key,
      advertId: Number(row.advert_id),
      nmId: Number(row.nm_id),
      clusterName: row.cluster_name,
      sourceKind: row.source_kind,
      isActive: row.is_active,
      views: this.toNullableNumber(row.views),
      clicks: this.toNullableNumber(row.clicks),
      orders: this.toNullableNumber(row.orders),
      addToCart: this.toNullableNumber(row.add_to_cart),
      ctr: this.toNullableNumber(row.ctr),
      avgPosition: this.toNullableNumber(row.avg_position),
      cpc: this.toNullableNumber(row.cpc),
      cpm: this.toNullableNumber(row.cpm),
      spend: this.toNullableNumber(row.spend),
      currency: row.currency,
      syncedAt: row.synced_at,
    }));
  }

  async getRawDailyStats(opts: {
    nmId?: number;
    limit: number;
  }): Promise<RawDailyStatRow[]> {
    if (!this.isConfigured()) return [];
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    const params: unknown[] = [opts.limit];
    const where = opts.nmId != null ? `WHERE nm_id = $2` : "";
    if (opts.nmId != null) params.push(opts.nmId);

    const result = await pool.query<{
      daily_stat_key: string;
      advert_id: string;
      nm_id: string;
      stat_date: string;
      cluster_name: string | null;
      views: string | null;
      clicks: string | null;
      orders: string | null;
      add_to_cart: string | null;
      shks: string | null;
      ctr: string | null;
      avg_position: string | null;
      cpc: string | null;
      cpm: string | null;
      spend: string | null;
      currency: string | null;
      synced_at: string | null;
    }>(
      `SELECT
        daily_stat_key,
        advert_id::text,
        nm_id::text,
        stat_date::text,
        cluster_name,
        views::text,
        clicks::text,
        orders::text,
        add_to_cart::text,
        shks::text,
        ctr::text,
        avg_position::text,
        cpc::text,
        cpm::text,
        spend::text,
        currency,
        synced_at::text
      FROM ${this.tableName("wb_cluster_daily_stats")}
      ${where}
      ORDER BY stat_date DESC, advert_id, nm_id
      LIMIT $1`,
      params,
    );

    return result.rows.map((row) => ({
      dailyStatKey: row.daily_stat_key,
      advertId: Number(row.advert_id),
      nmId: Number(row.nm_id),
      statDate: row.stat_date,
      clusterName: row.cluster_name,
      views: this.toNullableNumber(row.views),
      clicks: this.toNullableNumber(row.clicks),
      orders: this.toNullableNumber(row.orders),
      addToCart: this.toNullableNumber(row.add_to_cart),
      shks: this.toNullableNumber(row.shks),
      ctr: this.toNullableNumber(row.ctr),
      avgPosition: this.toNullableNumber(row.avg_position),
      cpc: this.toNullableNumber(row.cpc),
      cpm: this.toNullableNumber(row.cpm),
      spend: this.toNullableNumber(row.spend),
      currency: row.currency,
      syncedAt: row.synced_at,
    }));
  }

  async getRawMinusPhrases(opts: {
    nmId?: number;
    limit: number;
  }): Promise<RawMinusPhraseRow[]> {
    if (!this.isConfigured()) return [];
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    const params: unknown[] = [opts.limit];
    const where = opts.nmId != null ? `WHERE nm_id = $2` : "";
    if (opts.nmId != null) params.push(opts.nmId);

    const result = await pool.query<{
      advert_id: string;
      nm_id: string;
      phrase: string;
      normalized_phrase: string;
      synced_at: string | null;
    }>(
      `SELECT
        advert_id::text,
        nm_id::text,
        phrase,
        normalized_phrase,
        synced_at::text
      FROM ${this.tableName("wb_campaign_minus_phrases")}
      ${where}
      ORDER BY advert_id, nm_id, phrase
      LIMIT $1`,
      params,
    );

    return result.rows.map((row) => ({
      advertId: Number(row.advert_id),
      nmId: Number(row.nm_id),
      phrase: row.phrase,
      normalizedPhrase: row.normalized_phrase,
      syncedAt: row.synced_at,
    }));
  }

  async getRawQueryFrequencies(limit: number): Promise<RawQueryFrequencyRow[]> {
    if (!this.isConfigured()) return [];
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    const result = await pool.query<{
      normalized_query_text: string;
      query_text: string;
      monthly_frequency: string | null;
      report_type: string | null;
      report_start_date: string | null;
      report_end_date: string | null;
      synced_at: string | null;
    }>(
      `SELECT
        normalized_query_text,
        query_text,
        monthly_frequency::text,
        report_type,
        report_start_date::text,
        report_end_date::text,
        synced_at::text
      FROM ${this.tableName("wb_search_query_frequencies")}
      ORDER BY monthly_frequency DESC NULLS LAST
      LIMIT $1`,
      [limit],
    );

    return result.rows.map((row) => ({
      normalizedQueryText: row.normalized_query_text,
      queryText: row.query_text,
      monthlyFrequency: this.toNullableNumber(row.monthly_frequency),
      reportType: row.report_type,
      reportStartDate: row.report_start_date,
      reportEndDate: row.report_end_date,
      syncedAt: row.synced_at,
    }));
  }
}
