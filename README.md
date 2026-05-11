# Wildberries Automation Platform

Project for WB marketplace automation: fetch data from `WB API`, validate it,
normalize it inside the system, apply business rules, and safely prepare
outbound changes.

## Current state

- `NestJS + TypeScript` backend
- `React + Vite + TypeScript` frontend
- `WB_API_TOKEN` can be provided via `.env` or runtime dashboard field and is persisted into the writable server env file after saving
- preview, export, and archive flow for weekly WB search queries
- WB search-query exports now use an async job contract on the main click path: `POST /wb-sync/exports` immediately returns a machine-readable queued job keyed by the final `requestId`, `GET /wb-sync/exports/:requestId/status` exposes `queued -> running -> succeeded|failed`, and the saved export payload remains available from `GET /wb-sync/exports/:requestId` only after the background job finishes; dashboard run-export UI now acknowledges the click instantly and hydrates the final archive after polling instead of blocking on the full WB fetch
- WB Promotion API sync for advertising campaigns, product clusters, bids, minus phrases, product-level advertising sheets, and dedicated inventory-only sync for `advertId -> nmId[]`
- manual cluster bid edits now use canonical `normquery` writes with a durable latest-state queue, reduced manual debounce, larger cross-product batch claims, a targeted DB mutation lookup instead of reloading the full advertising sheet before every write, and a low-noise mode that suppresses background promotion reads during manual edits and after `429` windows; once WB accepts a bid write, the UI marks it confirmed locally without an immediate WB readback, and legacy readback reconcile jobs are cancelled instead of retrying forever
- manual cluster `include/exclude` changes now use a separate durable latest-state queue on top of `set-minus`, keep their own write-lane cooldown tracking instead of inheriting background promotion `429` blocks, and can flush multiple `(advertId, nmId)` groups through one `set-minus` request so reloads do not hide pending actions
- scheduled WB Promotion sync now runs as a phased pipeline every 10 minutes by default: `inventory` -> `structure` -> `stats`, and each phase drains its full ordered pool through continuous global batching instead of campaign-per-run budgets; the cadence is env-driven through `WB_PROMOTION_SYNC_CRON`, so production can keep the expected 10-minute refresh without hardcoding a slower hourly trigger; by default the background full sync also refreshes monthly frequency plus product-level `cmp.wildberries.ru` enrichment when the needed sources are available, and the canonical stats lookback now keeps a 30-day window so the product date filter can project a full calendar month
- full sync throughput is now observable through Promotion API lane telemetry, phase drain rates, and ETA estimates exposed by the backend status endpoint; raw archive writes are buffered, cluster/stat writes are batched, and the hot path is tuned through chunk sizes and WB lane intervals instead of per-phase campaign caps
- monthly frequency for product advertising clusters is read on the backend from WB Seller Analytics CSV search-query reports first, then falls back to the free seller-portal XLSX export (`Поисковые запросы на WB`) for the rolling 30-day window ending yesterday; product advertising sheets now expose canonical cluster/query rows from one authoritative merged query-map source, carry machine-readable query `mappingSource` plus `matchConfidence`, and keep cluster `count` plus `monthlyFrequency` recalculated from the same conservative aggregate-safe subset instead of the raw `words-clusters` import
- product advertising can now use a separate WB cabinet private-session source on Linux: a persisted seller storage-state file lets the backend call `cmp.wildberries.ru` server-side, archive cabinet probe metadata, and store cabinet-backed canonical cluster/query rows without requiring an open user tab
- on macOS, Safari-driven query-map backfill now reuses one dedicated WB tab/window for sequential `(advertId, nmId)` imports and writes those rows straight into authoritative `wb_cabinet_cluster_queries`, so product sheets can consume trusted `query -> cluster` mappings without polluting the legacy promotion-import layer
- product advertising now follows a DB-first snapshot-first read path: `products -> product` reads one canonical `advertising-sheet` snapshot from PostgreSQL, while search-text normalization, Jam enrichment, and WB promotion aggregation stay outside the user click path in snapshot materialization/jobs; the response contract carries a machine-readable `snapshot` block with `status`, `fit`, `source`, `builtAt`, requested range, and actual snapshot range so the frontend can distinguish `exact`, `latest schema`, `closest range`, and `most recent` ready snapshots without blank states or label-based branching
- product advertising read/write responsibilities are now explicit: user-facing `GET` sheet endpoints resolve `exact ready snapshot -> latest ready snapshot for same range -> closest ready snapshot for the requested range -> most recent ready snapshot for nmId -> explicit missing snapshot`, while the separate `/live` endpoint is reserved for diagnostic read-model inspection; snapshot persistence keeps lifecycle fields such as `status`, `built_from_export_request_id`, `ready_at`, `last_attempt_at`, `failure_reason`, and `source_kind`, and the frontend uses a dedicated product snapshot cache module as a repeat-open accelerator instead of treating export cache as the architectural source of truth
- product snapshot selection is now batch-aware on the backend: readiness and bundle/detail range reads choose one canonical winner snapshot per `nmId` before loading payload rows, instead of repeating several parallel summary branches and then resolving candidates one by one in higher layers
- products navigation is now list-first: opening `products` shows the goods list by default, while product detail opens only after an explicit click or a valid deep link; the dashboard keeps `list/detail` as an explicit UI mode instead of inferring detail state from any remembered `selectedProductNmId`
- the `products` tab now reads its list from a durable PostgreSQL read-model `wb_product_catalog` instead of the currently opened export payload: successful `product_search_texts` exports upsert catalog rows, startup backfill rehydrates catalog rows from stored archives, and the frontend keeps export data only as a metrics/detail overlay on top of the stable DB-backed catalog
- product detail cache keys are now aligned across list prefetch, detail fetch, and local snapshot caches through the same `(nmId, startDate, endDate)` request identity for the main sheet read path; `exportRequestId` remains part of readiness/materialize coordination only, because the user-facing `GET` resolver selects one canonical snapshot by product and range rather than by export id
- product advertising detail transitions now prefer the active range first: list snapshot prefetch/readiness stays limited to visible and candidate products in `products` list mode, active date/preset switches reuse memory/durable cache immediately, warm preset loads are delayed into idle/background time only after the active sheet is already usable, and duplicate in-flight sheet requests for the same `(nmId, startDate, endDate)` are coalesced instead of fan-out fetching on one click
- product advertising period metrics are now strict-by-range: campaign structure can still fall back to the latest usable snapshot for instant opens, but `spend` and other period-scoped metrics are exposed only when the requested range has exact/full daily coverage; the response contract marks this explicitly via machine-readable `periodMetricsStatus`, `periodMetricsReason`, and actual covered dates instead of silently showing fallback totals as if they belonged to the selected period
- product detail now uses a persistent three-slice backend-first workspace read-model: exact advertising-sheet materialization also stores workspace shell snapshots, campaign row snapshots, and lazy cluster-query snapshots in PostgreSQL, startup backfill repairs older ready sheet snapshots into the same workspace layer, and `GET /wb-clusters/products/:nmId/workspace`, `GET /wb-clusters/products/:nmId/campaigns/:advertId/workspace-cluster-table`, and `GET /wb-clusters/products/:nmId/campaigns/:advertId/workspace-cluster-queries` read those prepared workspace snapshots instead of rebuilding the detail screen from raw sheet arrays on click; frontend detail no longer depends on fetching the full advertising `sheet` in the happy-path open flow and instead refreshes the workspace slices together via a shared invalidation key
- the workspace shell payload for `GET /wb-clusters/products/:nmId/workspace` now carries an additive `initialClusterTable` for the default selected campaign when that first page is already materialized, so product detail can render the main campaign table from the same response and skip the extra first-open round-trip; the dedicated table endpoint remains the canonical source for non-default filters, sorts, and pagination
- dashboard frontend polish now treats bootstrap, section switches, and large tables as separate performance surfaces: shell refresh is staged instead of waiting for one all-or-nothing bundle, product-list readiness/warmup only runs while the `products` list is active, repeat-open workspace cache stays in memory/session while heavier sheet payloads prefer IndexedDB over eager localStorage writes, and the biggest product/method tables use windowed rendering so fallback DOM does not exceed the main path
- dashboard action UX now acknowledges intent immediately across more surfaces: run-export uses queued background status instead of a blocking request, token save/clear updates the local token session optimistically before backend reconcile, products list search uses deferred filtering work, product row hover now warms the workspace shell path in addition to snapshot candidates, method cards prefetch their latest archive on hover/focus, and cooldown ticking moved into tiny leaf components so the full exports/method sections do not rerender every second
- mutating `wb-clusters` routes now sit behind an explicit write boundary: the frontend sends `X-WB-Write-Intent: dashboard` on write commands, and production can harden the same boundary further with `WB_CLUSTERS_WRITE_API_KEY` plus `VITE_WB_CLUSTERS_WRITE_API_KEY`
- search-query export payloads now carry a machine-readable `productIndex[]` with canonical `{ vendorCode, nmId }` pairs, so dashboard product identity can read one stable export contract instead of re-deriving `vendorCode -> nmId` from raw WB tables; old cached exports may still use the legacy raw-table fallback as an explicit compatibility path
- raw WB export tables now also carry optional machine-readable `flattenedRows[]` plus ordered `columns[]`, so the dashboard raw-table viewer can consume one backend-owned tabular projection instead of flattening nested rows and inferring column order in the browser; older cached exports still fall back to the legacy client projection path
- UI protection against malformed or broken text
- production shared-host topology under `https://legendgames.space/wb/`

## Initial export scope

- weekly search queries for your products
- advertising data by product from WB Promotion API
- raw WB responses archived under `backend/data/search-queries/`
- saved exports can be reopened from the dashboard archive

## Setup

1. Copy `.env.example` to `.env`
2. Optionally fill `WB_API_TOKEN`
3. Optionally adjust `WB_API_BASE_URL`, `WB_API_TIMEOUT_MS`, and `WB_DEFAULT_LOCALE`
4. Tune phased Promotion sync only if needed: `WB_PROMOTION_DETAILS_CHUNK_SIZE` and the lane intervals `WB_PROMOTION_*_MIN_INTERVAL_MS`
5. Optional cabinet source on Linux: set `WB_CABINET_ENABLED=true` and point `WB_CABINET_STORAGE_STATE_PATH` to a persisted Playwright storage-state JSON; once available, the default 10-minute background full sync will enrich product data from `cmp.wildberries.ru`, and you can still opt out with `WB_CABINET_ENABLE_IN_FULL_SYNC=false`
6. Optional sync cadence override: set `WB_PROMOTION_SYNC_CRON` if production needs a different WB Promotion schedule than the default `*/10 * * * *`
7. Optional guarded write key: set `WB_CLUSTERS_WRITE_API_KEY` on the backend and the matching `VITE_WB_CLUSTERS_WRITE_API_KEY` on the frontend when you want mutating `wb-clusters` calls to require a shared key in addition to the dashboard write-intent header
8. Leave `VITE_API_BASE_URL` empty for the default relative `/api` dev+prod routing, or override it explicitly when needed

## Commands

```bash
npm install
npm run dev
```

Extra commands:

```bash
npm run dev:backend
npm run dev:frontend
npm run test
npm run test:reliability
npm run typecheck
npm run verify:fast
npm run smoke:local
npm run build
npm run verify:ci
npm run deploy:server-first:auto
npm run verify:prod
```

## Production deploy

- Public frontend path: `https://legendgames.space/wb/`
- Public API path: `https://legendgames.space/wb/api/`
- Canonical backend port: `3300`
- Canonical remote directory: `/var/www/wb-automation`
- Persistent export archive: `/var/www/wb-automation/shared/archives/search-queries`

See `docs/deploy.md` for PM2, nginx, env, and verification details.

## Engineering rails

- local fast gate: `npm run verify:fast`
- CI gate: `npm run verify:ci`
- local smoke gate: `npm run smoke:local`
- production health gate: `npm run verify:prod`
- focused contract/cache/health gate: `npm run test:reliability`
- delivery checklist and maturity roadmap: `docs/engineering-rails.md`
- runtime and release checklist: `docs/runtime-reliability.md`
- compatibility and backfill workflow: `docs/compatibility-backfill.md`
- scale-readiness checklist: `docs/scale-readiness.md`

## Project rules

- keep contracts machine-readable
- separate transport, business logic, and data access
- validate inbound and outbound payloads before use
- treat broken UI text as invalid display data
- keep critical env reads centralized and fail-fast
