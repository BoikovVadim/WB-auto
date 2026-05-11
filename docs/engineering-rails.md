# Engineering Rails

This document defines the first stable engineering baseline for the project so
new work can land through one repeatable path instead of ad hoc local habits.

## Baseline goals

- one shared local verification loop before merge
- one CI entrypoint that matches local checks
- one durable checklist for risky change types
- one roadmap for reliability and scale hardening

## Core commands

Run these from the workspace root:

```bash
npm run test:reliability
npm run test
npm run verify:fast
npm run verify:ci
npm run verify:prod
```

- `test:reliability`: targeted guardrail suite for contract-heavy and persistence-heavy paths
- `test`: focused unit and contract checks for critical pure flows
- `verify:fast`: lint, typecheck, and the targeted reliability suite for day-to-day development
- `verify:ci`: lint, typecheck, test, and build through the shared root npm gate
- `verify:prod`: deployed health checks for the public service

## Change checklist

Use the project rules first, then confirm the matching delivery checklist before
finishing a change.

### Contract or DTO change

- update backend DTOs, builders, and validators
- update frontend readers, types, and cache identity or invalidation
- review compatibility for old snapshots, archives, and stored cache payloads
- verify loading, empty, fallback, and error branches still match the contract

### Read-model or heavy screen change

- keep `GET` paths read-only
- prefer backend-owned shaping for totals, pagination, filtering, and fallback
- avoid rebuilding domain semantics from raw arrays in the browser
- verify the main open flow still works without foreground repair or warmup

### Write path or sync change

- define request intent, status lifecycle, retry policy, and idempotency
- validate inbound and outbound payloads explicitly
- log durable success or failure with enough context for diagnosis
- verify read paths do not inherit write-side side effects
- make deploy exceptions explicit: `DEPLOY_SKIP_VERIFY=1` requires a human-readable `DEPLOY_SKIP_VERIFY_REASON`

### File growth check

- extract instead of extending when a file mixes multiple responsibilities
- keep new logic in the nearest bounded helper, hook, builder, service, or repository
- prefer explicit ownership over convenience imports into an existing large file

## Maturity roadmap

### Stage 1: Foundation

- project-wide rules and docs aligned
- local and CI verification use the same root command contract
- core build, lint, and typecheck gates are mandatory before merge
- risky change types follow one documented checklist

### Stage 2: Runtime reliability

- structured logs and telemetry across critical sync and write flows
- explicit timeout, retry, cooldown, and idempotency policy where needed
- smoke or integration checks for the most valuable user and sync paths
- freshness and degradation behavior documented for read models

### Stage 3: Scale readiness

- hotspot query review and bounded payload strategy
- stronger backfill and compatibility workflow for persisted data changes
- release, rollback, and incident response discipline for production changes
- periodic architecture review so docs and rules stay aligned with the codebase
