# Module Map

Use this file to choose the smallest code area before searching the repo.

## Backend

- `backend/src/common/`
  Shared env helpers, utility code, common errors, and production runtime path resolution.
- `backend/src/health/`
  Health-check endpoints.
- `backend/src/wb-sync/`
  WB API integration, runtime token session, export archive, request guards, validation, and the async export-job contract. `POST /wb-sync/exports` should acknowledge immediately with a machine-readable queued job keyed by the final `requestId`; `GET /wb-sync/exports/:requestId/status` owns the background lifecycle, while `GET /wb-sync/exports/:requestId` remains the ready-result/archive reader.
- `backend/src/wb-clusters/`
  WB Promotion and product advertising bounded context. Read it in four slices instead of treating it as one giant service:
  - `sync/orchestration`: env-driven 10-minute/manual promotion sync, phased `inventory -> structure -> stats` cursors, lane telemetry, raw archive buffering, and durable write queues for bids/actions
  - `read-model`: SQL-backed product advertising sheet, stable `wb_product_catalog` rows for the `products` tab, cluster/query canonicalization, query mapping confidence, cabinet/promotion merged read data, and dedicated workspace read-model assembly in focused services instead of bloating the orchestration facade
  - `snapshot lifecycle`: product search-text range snapshots, final product advertising snapshots, snapshot resolver/materializer, and machine-readable `snapshot` metadata for `exact -> latest schema -> closest range -> most recent` ready fallback; current range reads should choose one winner snapshot per `nmId` in a batch-aware repository path before loading payload JSON
  - `jobs`: preset snapshot jobs, export-seeded materialization, retry scheduling, archive-to-catalog backfill, and range preparation outside the user read path, now coordinated through dedicated services instead of dashboard click-path mutations
  - `repository persistence families`: `wb-clusters.repository.ts` stays the stable Nest facade, while internal persistence now lives in focused repository layers for sync/cursor state, jobs, snapshots/catalog/archive storage, campaign/query/stat writes, and advertising read-model lookups. Follow the inheritance chain by family: `*.sync-run-write.ts` / `*.sync-run-read.ts` for sync/cursor state, `*.bid-job-persistence.ts` / `*.action-job-persistence.ts` / `*.preset-snapshot-job-persistence.ts` for queue durability, `*.snapshot-summaries.ts` / `*.search-text-storage.ts` / `*.product-sheet-storage.ts` / `*.catalog-storage.ts` for snapshot and catalog storage, `*.campaign-*.ts` / `*.cluster-*.ts` for write paths, and `*.campaign-inventory-read.ts` / `*.advertising-*.ts` for DB-backed read models.
  The module keeps ordinary product reads DB-first, makes user-facing `GET` resolve stored snapshots before any fallback, exposes a separate live diagnostic route instead of mixing read-model fallback into the main read path, stores lifecycle metadata like `status`, `ready_at`, `failure_reason`, and `source_kind`, serves the `products` list from the durable catalog endpoint instead of export JSON, and now continues the product detail migration through dedicated backend-first workspace read-model endpoints backed by persistent workspace snapshots: `products/:nmId/workspace` reads a stored shell/header/date-bounds/campaign-tab snapshot plus diagnostics/sync-state overlay and may also carry an additive `initialClusterTable` for the default selected campaign, `products/:nmId/campaigns/:advertId/workspace-cluster-table` reads stored campaign row snapshots and applies backend-owned numeric filtering, filtered-population totals, and pagination, and `products/:nmId/campaigns/:advertId/workspace-cluster-queries` reads stored lazy query groups for one stable machine-readable `clusterKey`. Exact advertising-sheet materialization now also writes these workspace snapshots, and a startup backfill repairs older ready sheet snapshots so the detail GET path stays read-only. Internal read/write helpers are now routed through explicit families as well: `wb-clusters-action-queue.*` and `wb-clusters-bid-queue.*` for durable outbound queue passes, `product-advertising-sheet.response.*` / `product-advertising-sheet.snapshot.jam.*` / `product-workspace*.ts` for response and workspace shaping, `wb-clusters-read-flow.readiness*` and `wb-clusters-command-flow.*` for request-time readiness and manual command helpers, and `safari-import.*` / `cabinet-query-map-safari-import*` for Safari-driven import scripts instead of one-off monolith files. Mutating `wb-clusters` routes should stay behind the explicit write guard/header boundary. The happy-path detail open flow should not require fetching the full advertising sheet anymore; old sheet reads are debug/support paths only.
- `backend/src/catalog/`
  Product cards and related attributes.
- `backend/src/pricing/`
  Price rules and price publishing.
- `backend/src/stocks/`
  Stocks, warehouses, and stock publishing.
- `backend/src/orders/`
  Order ingestion and processing.
- `backend/src/analytics/`
  Reports and normalized read models.

## Frontend

- `Frontend/src/api/`
  API clients, token session calls, export archive calls, async export-job polling, WB Promotion product advertising calls, runtime response validation, plus separate cache modules for export history/archive, the stable product catalog list, and product snapshot detail reads. Search-query exports should prefer the machine-readable `payload.productIndex[]` contract for `vendorCode -> nmId` identity, export launch should treat `requestId` as the canonical job/result identity across `POST /exports -> GET /exports/:requestId/status -> GET /exports/:requestId`, and raw-table rendering should prefer backend `flattenedRows[]` plus ordered `columns[]` instead of rescanning or flattening raw WB tables except as an explicit legacy fallback.
- `Frontend/src/runtimePaths.ts`
  Shared base-path helpers for `/wb/` frontend routing and relative API resolution.
- `Frontend/src/components/`
  Shared shell and layout components.
- `Frontend/src/features/dashboard/`
  Main dashboard, token input, archive menu, preview, and export viewer UI. `WbDashboard` should stay page orchestration only, with shell/layout rendering in `WbDashboardShell` and stateful flows in dedicated hooks/actions modules. `products` should stay list-first: stable catalog loading in dedicated hooks, product selection in dedicated hooks, and product advertising snapshot loading in `features/dashboard/advertising/` only when the UI is in explicit detail mode instead of inferring detail from restored selection state or deriving the list from the current export payload. Keep product advertising transitions active-range-first: list prefetch belongs to list mode, but hot loops must stay bounded to visible/candidate products, detail date/preset switches should reuse cached usable sheets immediately, and warm preset fetches must stay idle/background/low-priority instead of blocking the click path. For the main sheet read path, cache/request identity must stay canonical as `(nmId, startDate, endDate)`; `exportRequestId` belongs to readiness/materialize orchestration only because backend `GET` resolves one snapshot chain by product and range. For `РК`, separate instant structure from exact period metrics: fallback snapshots may keep the campaign shell visible, but `spend` and other period-scoped totals must only render when the backend marks the selected range as exact via the machine-readable period-metrics contract. Product detail should now prefer the backend `workspace` shell contract for tabs/bounds/header data, consume additive `initialClusterTable` when present for the default first-open campaign view, request cluster query expansions by `clusterKey`, and consume backend table slices for numeric filters/totals/pagination instead of rebuilding those summaries from raw `sheet` arrays on every mount. Dashboard actions should acknowledge immediately: method-card hover can prefetch the latest archive, product-row hover can warm the workspace path, token save/clear may show optimistic local session state before reconcile, and export launch should switch into background job polling instead of blocking on the final archive payload.

## Deploy

- `ecosystem.config.js`
  Canonical PM2 app definition for production on `/var/www/wb-automation`.
- `scripts/`
  Deploy entrypoints and production verification commands.
- `docs/engineering-rails.md`
  Shared local and CI verification commands, risky-change checklist, and the staged reliability roadmap.
- `docs/runtime-reliability.md`
  Runtime retry, smoke, deploy, and rollback checklist for reliability-sensitive changes.
- `docs/compatibility-backfill.md`
  Workflow for contract evolution, persisted-data compatibility, and backfill decisions.
- `docs/scale-readiness.md`
  Hotspot review, read-model/materialization strategy, and bounded-context ownership notes for project growth.
- `deploy/production.env.example`
  Production runtime env template, including persistent archive storage.
- `deploy/nginx/legendgames.space-wb.conf`
  Additive nginx snippet for `/wb/` and `/wb/api/` on the shared domain.
- `docs/deploy.md`
  Production topology, bootstrap, rollout, and verification reference.

## Rules

- `.cursor/rules/change-protocol.mdc`
- `.cursor/rules/compatibility-and-backfill.mdc`
- `.cursor/rules/core-architecture.mdc`
- `.cursor/rules/proactive-file-decomposition.mdc`
- `.cursor/rules/backend-layering.mdc`
- `.cursor/rules/frontend-dashboard-and-api.mdc`
- `.cursor/rules/cache-and-invalidation.mdc`
- `.cursor/rules/machine-readable-contracts.mdc`
- `.cursor/rules/wb-sync-and-audit.mdc`
- `.cursor/rules/ui-language-and-tables.mdc`
