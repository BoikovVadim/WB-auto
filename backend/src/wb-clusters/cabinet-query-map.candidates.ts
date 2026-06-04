/**
 * Кандидаты для обновления карты запросов кластеров (wb_cabinet_cluster_queries):
 * пары (advertId, nmId) активных/приостановленных РК, «самые несвежие первыми».
 *
 * WB cmp-сессия живёт ограниченно, за прогон успевает не всё → порядок
 * captured_at ASC NULLS FIRST ротирует хвост, иначе старые advert_id никогда бы
 * не обновлялись. Используется headless-раннером (run-headless-query-map).
 */
import type { Client } from "pg";

export type AdvertNmMap = Map<number, number[]>;

export async function loadCabinetQueryMapCandidates(client: Client): Promise<AdvertNmMap> {
  // Только active (9) и paused (11); archived (7) пропускаем.
  const { rows } = await client.query<{ advert_id: string; nm_id: string }>(
    `SELECT cp.advert_id::text, cp.nm_id::text
     FROM public.wb_campaign_products cp
     JOIN public.wb_campaigns c ON c.advert_id = cp.advert_id
     LEFT JOIN public.wb_cabinet_cluster_queries q
       ON q.advert_id = cp.advert_id AND q.nm_id = cp.nm_id
     WHERE c.campaign_status IN (9, 11)
     GROUP BY cp.advert_id, cp.nm_id
     ORDER BY MAX(q.captured_at) ASC NULLS FIRST, cp.advert_id, cp.nm_id`,
  );
  const map: AdvertNmMap = new Map();
  for (const row of rows) {
    const advertId = Number(row.advert_id);
    const nmId = Number(row.nm_id);
    if (!map.has(advertId)) map.set(advertId, []);
    map.get(advertId)!.push(nmId);
  }
  return map;
}
