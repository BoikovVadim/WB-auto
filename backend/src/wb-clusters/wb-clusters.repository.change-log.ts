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

  /** Returns unified change history from both tables, newest first. */
  async getUnifiedChangeLog(limit = 500): Promise<UnifiedChangeLogEntry[]> {
    const pool = this.getPool();
    const result = await pool.query<UnifiedChangeLogRow>(
      `
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
        TO_CHAR(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
      FROM ${this.tableName("wb_cluster_change_log")}

      UNION ALL

      SELECT
        id,
        'system' AS source,
        entity_type,
        nm_id::text AS nm_id,
        entity_label,
        change_type,
        old_value,
        new_value,
        TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
      FROM ${this.tableName("wb_system_change_log")}

      ORDER BY created_at DESC
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
