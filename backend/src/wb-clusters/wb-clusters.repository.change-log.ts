import { WbClustersRepositoryCostPrice } from "./wb-clusters.repository.cost-price";

export type ChangeLogEntryInput = {
  nmId: number;
  advertId: number;
  clusterName: string;
  changeType: "status_change" | "bid_change";
  oldValue: string | null;
  newValue: string;
  jobId: string | null;
};

type ChangeLogEntryRow = {
  id: string;
  nm_id: string;
  advert_id: string;
  cluster_name: string;
  change_type: string;
  old_value: string | null;
  new_value: string;
  job_id: string | null;
  applied_at: string;
};

export type ChangeLogEntry = {
  id: string;
  nmId: number;
  advertId: number;
  clusterName: string;
  changeType: "status_change" | "bid_change";
  oldValue: string | null;
  newValue: string;
  jobId: string | null;
  appliedAt: string;
};

export abstract class WbClustersRepositoryChangeLog extends WbClustersRepositoryCostPrice {
  /**
   * Returns a map of normalized_cluster_name → current bid for the given clusters.
   * The input clusterNames should be the canonical norm_query values (already lowercased/trimmed)
   * as stored in wb_cluster_bids.normalized_cluster_name.
   */
  async getCurrentClusterBids(
    nmId: number,
    advertId: number,
    clusterNames: string[],
  ): Promise<Map<string, number>> {
    if (clusterNames.length === 0) return new Map();
    const pool = this.getPool();
    const normalized = clusterNames.map((n) =>
      n.trim().toLocaleLowerCase("ru").replace(/\s+/g, " "),
    );
    const result = await pool.query<{ normalized_cluster_name: string; bid: string }>(
      `
      SELECT normalized_cluster_name, bid::text AS bid
      FROM ${this.tableName("wb_cluster_bids")}
      WHERE nm_id = $1
        AND advert_id = $2
        AND normalized_cluster_name = ANY($3::text[])
        AND bid IS NOT NULL
      `,
      [nmId, advertId, normalized],
    );
    const map = new Map<string, number>();
    for (const row of result.rows) {
      const bid = Number(row.bid);
      if (Number.isFinite(bid)) {
        map.set(row.normalized_cluster_name, bid);
      }
    }
    return map;
  }

  async saveChangeLogEntries(entries: ChangeLogEntryInput[]): Promise<void> {
    if (entries.length === 0) return;
    const pool = this.getPool();

    const placeholders = entries
      .map(
        (_, i) =>
          `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7})`,
      )
      .join(", ");

    const values = entries.flatMap((e) => [
      e.nmId,
      e.advertId,
      e.clusterName,
      e.changeType,
      e.oldValue,
      e.newValue,
      e.jobId,
    ]);

    await pool.query(
      `
      INSERT INTO ${this.tableName("wb_cluster_change_log")}
        (nm_id, advert_id, cluster_name, change_type, old_value, new_value, job_id)
      VALUES ${placeholders}
      `,
      values,
    );
  }

  async getChangeLogEntries(
    nmId: number,
    advertId: number,
    limit = 200,
  ): Promise<ChangeLogEntry[]> {
    const pool = this.getPool();
    const result = await pool.query<ChangeLogEntryRow>(
      `
      SELECT id, nm_id, advert_id, cluster_name, change_type, old_value, new_value, job_id,
             TO_CHAR(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS applied_at
      FROM ${this.tableName("wb_cluster_change_log")}
      WHERE nm_id = $1 AND advert_id = $2
      ORDER BY applied_at DESC
      LIMIT $3
      `,
      [nmId, advertId, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      nmId: Number(row.nm_id),
      advertId: Number(row.advert_id),
      clusterName: row.cluster_name,
      changeType: row.change_type as "status_change" | "bid_change",
      oldValue: row.old_value,
      newValue: row.new_value,
      jobId: row.job_id,
      appliedAt: row.applied_at,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // System-wide change log (wb_system_change_log)
  // ─────────────────────────────────────────────────────────────────────────

  async saveSystemChangeLogEntry(entry: {
    entityType: string;
    nmId: number | null;
    entityLabel: string | null;
    changeType: string;
    oldValue: string | null;
    newValue: string | null;
  }): Promise<void> {
    const pool = this.getPool();
    await pool.query(
      `
      INSERT INTO ${this.tableName("wb_system_change_log")}
        (entity_type, nm_id, entity_label, change_type, old_value, new_value)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [entry.entityType, entry.nmId, entry.entityLabel, entry.changeType, entry.oldValue, entry.newValue],
    );
  }

  /**
   * Returns unified change history from both tables, newest first.
   *
   * Дедупликация: внешний репрайсер иногда дважды шлёт один и тот же PUT .../price —
   * оба запроса читают ещё не применённую (queued) цену как «текущую» и пишут две
   * идентичные записи. Схлопываем идущие подряд во времени записи с одинаковым
   * (change_type, old_value, new_value) для одного объекта — это повтор того же
   * состояния, не новое изменение. Реальные переходы (A→B→A) не трогаются: соседние
   * записи у них различаются. Сырые строки в таблицах остаются — режем только на чтении.
   */
  async getUnifiedChangeLog(limit = 500): Promise<UnifiedChangeLogEntry[]> {
    const pool = this.getPool();
    const result = await pool.query<UnifiedChangeLogRow>(
      `
      WITH unified AS (
        SELECT
          id,
          'cluster' AS source,
          CASE change_type
            WHEN 'bid_change'    THEN 'cluster_bid'
            WHEN 'status_change' THEN 'cluster_status'
            ELSE change_type
          END AS entity_type,
          nm_id::text AS nm_id,
          cluster_name AS entity_label,
          change_type,
          old_value,
          new_value,
          applied_at AS event_at
        FROM ${this.tableName("wb_cluster_change_log")}

        UNION ALL

        SELECT
          id,
          'system' AS source,
          entity_type,
          nm_id::text AS nm_id,
          entity_label,
          change_type,
          -- В истории показываем цену без «(база N)» — служебная база нужна только в
          -- сыром аудите. Дедуп ниже работает уже по очищенному значению.
          regexp_replace(old_value, ' \\(база [0-9]+\\)$', '') AS old_value,
          regexp_replace(new_value, ' \\(база [0-9]+\\)$', '') AS new_value,
          created_at AS event_at
        FROM ${this.tableName("wb_system_change_log")}
      ),
      flagged AS (
        SELECT
          unified.*,
          LAG(change_type) OVER w AS prev_change_type,
          LAG(old_value)   OVER w AS prev_old_value,
          LAG(new_value)   OVER w AS prev_new_value
        FROM unified
        WINDOW w AS (
          PARTITION BY source, entity_type, nm_id, COALESCE(entity_label, '')
          ORDER BY event_at, id
        )
      )
      SELECT
        id,
        source,
        entity_type,
        nm_id,
        entity_label,
        change_type,
        old_value,
        new_value,
        TO_CHAR(event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
      FROM flagged
      WHERE NOT (
        change_type IS NOT DISTINCT FROM prev_change_type
        AND old_value IS NOT DISTINCT FROM prev_old_value
        AND new_value IS NOT DISTINCT FROM prev_new_value
      )
      ORDER BY event_at DESC, id DESC
      LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      source: row.source as "cluster" | "system",
      entityType: row.entity_type,
      nmId: row.nm_id !== null ? Number(row.nm_id) : null,
      entityLabel: row.entity_label,
      changeType: row.change_type,
      oldValue: row.old_value,
      newValue: row.new_value,
      createdAt: row.created_at,
    }));
  }
}

type UnifiedChangeLogRow = {
  id: string;
  source: string;
  entity_type: string;
  nm_id: string | null;
  entity_label: string | null;
  change_type: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

export type UnifiedChangeLogEntry = {
  id: string;
  source: "cluster" | "system";
  entityType: string;
  nmId: number | null;
  entityLabel: string | null;
  changeType: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};
