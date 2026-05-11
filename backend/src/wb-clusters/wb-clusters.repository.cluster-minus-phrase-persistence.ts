import { WbClustersRepositoryClusterBidPersistence } from "./wb-clusters.repository.cluster-bid-persistence";

export abstract class WbClustersRepositoryClusterMinusPhrasePersistence extends WbClustersRepositoryClusterBidPersistence {
  async replaceCampaignMinusPhrases(
    items: Array<{ advertId: number; nmId: number }>,
    minusItems: Array<{
      advert_id: number;
      nm_id: number;
      norm_queries?: string[] | null;
    }>,
  ) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const uniqueItems = Array.from(
        new Map(
          items.map((item) => [`${item.advertId}:${item.nmId}`, item]),
        ).values(),
      );

      for (const item of uniqueItems) {
        await client.query(
          `DELETE FROM ${this.tableName("wb_campaign_minus_phrases")} WHERE advert_id = $1 AND nm_id = $2`,
          [item.advertId, item.nmId],
        );
      }

      const flattenedRows = Array.from(
        new Map(
          minusItems.flatMap((minusItem) =>
            (minusItem.norm_queries ?? []).map((phrase) => {
              const minusPhraseKey = this.buildScopedTextKey(
                minusItem.advert_id,
                minusItem.nm_id,
                phrase,
              );
              return [
                minusPhraseKey,
                {
                  minusPhraseKey,
                  advertId: minusItem.advert_id,
                  nmId: minusItem.nm_id,
                  phrase,
                  normalizedPhrase: this.normalizeQuery(phrase),
                },
              ] as const;
            }),
          ),
        ).values(),
      );
      if (flattenedRows.length > 0) {
        await client.query(
          `
            INSERT INTO ${this.tableName("wb_campaign_minus_phrases")} (
              minus_phrase_key,
              advert_id,
              nm_id,
              phrase,
              normalized_phrase,
              synced_at
            )
            SELECT
              minus_phrase_key,
              advert_id,
              nm_id,
              phrase,
              normalized_phrase,
              NOW()
            FROM UNNEST(
              $1::text[],
              $2::bigint[],
              $3::bigint[],
              $4::text[],
              $5::text[]
            ) AS rows(
              minus_phrase_key,
              advert_id,
              nm_id,
              phrase,
              normalized_phrase
            )
            ON CONFLICT (minus_phrase_key) DO UPDATE
            SET
              phrase = EXCLUDED.phrase,
              normalized_phrase = EXCLUDED.normalized_phrase,
              synced_at = NOW()
          `,
          [
            flattenedRows.map((row) => row.minusPhraseKey),
            flattenedRows.map((row) => row.advertId),
            flattenedRows.map((row) => row.nmId),
            flattenedRows.map((row) => row.phrase),
            flattenedRows.map((row) => row.normalizedPhrase),
          ],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getCampaignMinusPhrases(advertId: number, nmId: number) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{ phrase: string }>(
      `
        SELECT phrase
        FROM ${this.tableName("wb_campaign_minus_phrases")}
        WHERE advert_id = $1
          AND nm_id = $2
        ORDER BY phrase
      `,
      [advertId, nmId],
    );

    return result.rows.map((row) => row.phrase);
  }

}
