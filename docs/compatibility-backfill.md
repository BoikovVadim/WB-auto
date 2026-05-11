# Compatibility And Backfill

This document turns the project compatibility rules into one repeatable workflow
for contract and persisted-data changes.

## When to use this workflow

Use it when a change affects any of these:

- backend DTO shape
- frontend reader or validator shape
- snapshot meaning or fallback semantics
- cached payload identity
- archived raw payload interpretation
- persisted PostgreSQL rows

## Decision flow

### 1. Identify the meaning change

State explicitly whether the change is:

- additive and backward compatible
- a replacement with a temporary alias
- a persisted-data meaning change that needs repair or backfill

### 2. Name the affected layers

Review all relevant surfaces together:

- backend service or resolver
- DTO, serializer, builder, or normalizer
- frontend type, reader, validator, and cache layer
- stored snapshots, archives, and DB rows
- docs and rules

### 3. Choose the compatibility posture

- **Additive field**: old readers can ignore it safely
- **Compatibility alias**: old and new shapes coexist temporarily in one reader or mapper layer
- **Backfill required**: old stored data must be repaired or treated as incompatible
- **Explicit rejection**: old shape is no longer valid and must return a machine-readable error state

## Backfill checklist

Before shipping a backfill-sensitive change:

1. Identify which persisted records can still be read after deploy.
2. Decide whether those records are:
   - still valid as-is
   - transformable through compatibility logic
   - invalid and must be repaired
3. Document the expected degraded behavior while old data exists.
4. Add or update tests for the compatibility branch if the old shape remains supported.
5. Add a migration note to the relevant docs when the meaning changes durably.

## Snapshot-specific notes

- keep snapshot freshness and fallback policy machine-readable
- do not silently reinterpret old snapshot status or fit values
- prefer one explicit incompatible response over scattered ad hoc fallbacks
- if startup or background backfill repairs old snapshots, keep user-facing `GET` paths read-only

## Release note template

For compatibility-sensitive changes, record:

- what meaning changed
- which old records or cache payloads are affected
- whether a backfill is required
- what temporary compatibility logic exists
- what signal marks the compatibility layer safe to remove
