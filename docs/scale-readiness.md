# Scale Readiness

This document captures the operational interpretation of Stage 3 so project
growth stays deliberate instead of reactive.

## Goals

- hotspot reviews happen before pain becomes outages
- heavy reads move toward bounded read models and materialization
- ownership stays clear across bounded contexts
- deploy and rollback discipline remain explicit as the codebase grows

## Hotspot review checklist

Review these areas when a feature grows in traffic, payload size, or business
importance:

- PostgreSQL queries that read large row sets or repeated per-item lookups
- endpoints that return heavy tables or nested detail payloads
- browser code rebuilding server-owned summaries from raw arrays
- background jobs that reprocess the same large pools without durable cursors
- write paths that can create broad invalidation or retry storms

## Materialization and read-model strategy

Prefer this order for heavy screens and repeated reads:

1. canonical stored snapshot or read model
2. focused backend slice for shell, table, or detail
3. lazy expansion by stable machine-readable identity
4. background repair or materialization outside the user read path

Avoid:

- foreground rebuilds in user-facing `GET` flows
- one giant endpoint that mixes shell, heavy table, and lazy detail concerns
- parallel sources of truth for the same read model

## Bounded-context ownership

Use these ownership rules as the codebase grows:

- `wb-sync`: inbound WB API fetch, archive, normalization, runtime token session
- `wb-clusters`: promotion sync, product advertising snapshots, workspace reads, write queues
- `catalog`: durable product identity and product cards
- `pricing`: rule evaluation and price publishing
- `stocks`: stock source of truth, warehouse shaping, stock publishing
- `orders`: ingestion, normalization, processing lifecycle
- `analytics`: aggregated and time-windowed reporting read models

If a feature crosses multiple contexts, keep orchestration explicit instead of
hiding second-source logic inside one module.

## Release and rollback at scale

When a change touches high-traffic or high-risk flows:

1. run `npm run verify:ci`
2. document any compatibility or backfill implication
3. deploy with the canonical script unless intentionally using another path
4. verify health and the affected runtime signals after rollout
5. keep the last known good artifact set restorable before the next rollout

## Review cadence

Revisit this document when:

- a new heavy screen or sync pipeline lands
- a bounded context changes ownership
- a persistent fallback or compatibility layer survives longer than expected
- the deploy or rollback path changes materially
