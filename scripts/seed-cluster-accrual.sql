-- ОДНОРАЗОВЫЙ СИД накопителя кластеров (wb_cluster_accrual).
--
-- Назначение: проставить накопл = сумме за последние 30 дней (расход/заказы РК/JAM/показы) в
-- ТЕКУЩУЮ ценовую корзину каждой автоматизированной кампании. Дальше ежедневный крон
-- accrueYesterdayForAll доливает сам (last_accrued_date = вчера → завтра добавит сегодня, без
-- двойного счёта).
--
-- ВНИМАНИЕ: это ПЕРЕЗАПИСЬ (overwrite) текущей корзины, а не прибавление. Повторный запуск
-- сбросит накопление обратно к 30-дневному окну — запускать ОДИН раз.
--
-- Окно: [MSK-вчера − 29 дней .. MSK-вчера]. Корзина = ±2.5% уровень по цене со скидкой (как
-- priceBucket в коде). JAM-логика повторяет getDailyClusterDeltas (FULL OUTER JOIN РК+JAM).
-- Запуск: psql "$DATABASE_URL" -f scripts/seed-cluster-accrual.sql

WITH bounds AS (
  SELECT ((now() AT TIME ZONE 'Europe/Moscow')::date - 1) AS to_date,
         ((now() AT TIME ZONE 'Europe/Moscow')::date - 30) AS from_date
),
auto AS (
  SELECT advert_id, nm_id FROM wb_campaign_automation WHERE mode IN ('preview', 'live')
),
rk AS (
  -- РК-заказы = заказанные товары (shks), fallback на orders — как CPO/таблица (shks ?? orders).
  SELECT s.advert_id, s.nm_id, s.normalized_cluster_name AS ncn,
         SUM(s.spend) AS spend, COALESCE(SUM(s.shks), SUM(s.orders)) AS orders_rk, SUM(s.views) AS views
  FROM wb_cluster_daily_stats s
  JOIN auto a ON a.advert_id = s.advert_id AND a.nm_id = s.nm_id
  CROSS JOIN bounds b
  WHERE s.stat_date BETWEEN b.from_date AND b.to_date
  GROUP BY s.advert_id, s.nm_id, s.normalized_cluster_name
),
jam AS (
  SELECT cq.advert_id, cq.nm_id, LOWER(TRIM(cq.cluster_name)) AS ncn,
         SUM(r.orders_current) AS orders_jam
  FROM wb_cabinet_cluster_queries cq
  JOIN auto a ON a.advert_id = cq.advert_id AND a.nm_id = cq.nm_id
  CROSS JOIN bounds b
  JOIN wb_product_search_text_range_snapshots s
    ON s.nm_id = cq.nm_id AND s.start_date = s.end_date
   AND s.start_date BETWEEN b.from_date AND b.to_date
  JOIN wb_product_search_text_range_rows r
    ON r.snapshot_key = s.snapshot_key
   AND r.normalized_query_text = cq.normalized_query_text
  GROUP BY cq.advert_id, cq.nm_id, LOWER(TRIM(cq.cluster_name))
),
merged AS (
  SELECT COALESCE(rk.advert_id, jam.advert_id) AS advert_id,
         COALESCE(rk.nm_id, jam.nm_id)         AS nm_id,
         COALESCE(rk.ncn, jam.ncn)             AS ncn,
         COALESCE(rk.spend, 0)                 AS spend,
         COALESCE(rk.orders_rk, 0)             AS orders_rk,
         COALESCE(jam.orders_jam, 0)           AS orders_jam,
         COALESCE(rk.views, 0)                 AS views
  FROM rk
  FULL OUTER JOIN jam
    ON jam.advert_id = rk.advert_id AND jam.nm_id = rk.nm_id AND jam.ncn = rk.ncn
),
price AS (
  SELECT p.nm_id, (p.price * (1 - COALESCE(p.discount, 0)::numeric / 100)) AS eff
  FROM wb_product_daily_prices p
  JOIN (
    SELECT nm_id, MAX(price_date) AS md
    FROM wb_product_daily_prices, bounds b
    WHERE price_date <= b.to_date
    GROUP BY nm_id
  ) lat ON lat.nm_id = p.nm_id AND lat.md = p.price_date
),
bucketed AS (
  SELECT m.advert_id, m.nm_id, m.ncn, m.spend, m.orders_rk, m.orders_jam, m.views,
         pr.eff AS base_price,
         CASE WHEN pr.eff IS NULL OR pr.eff <= 0 THEN '0'
              ELSE round(power(1.05, round(ln(pr.eff) / ln(1.05))))::text END AS price_bucket
  FROM merged m
  LEFT JOIN price pr ON pr.nm_id = m.nm_id
)
INSERT INTO wb_cluster_accrual
  (advert_id, nm_id, normalized_cluster_name, price_bucket, base_price,
   accrued_spend, accrued_orders_rk, accrued_orders_jam, accrued_views, last_accrued_date)
SELECT b.advert_id, b.nm_id, b.ncn, b.price_bucket, b.base_price,
       b.spend, b.orders_rk, b.orders_jam, b.views, bo.to_date
FROM bucketed b CROSS JOIN bounds bo
WHERE b.advert_id IS NOT NULL AND b.nm_id IS NOT NULL AND b.ncn IS NOT NULL
ON CONFLICT (advert_id, nm_id, normalized_cluster_name, price_bucket)
DO UPDATE SET
  accrued_spend      = EXCLUDED.accrued_spend,
  accrued_orders_rk  = EXCLUDED.accrued_orders_rk,
  accrued_orders_jam = EXCLUDED.accrued_orders_jam,
  accrued_views      = EXCLUDED.accrued_views,
  last_accrued_date  = EXCLUDED.last_accrued_date,
  base_price         = COALESCE(EXCLUDED.base_price, wb_cluster_accrual.base_price),
  updated_at         = NOW();
