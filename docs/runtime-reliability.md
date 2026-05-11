# Runtime Reliability

This document captures the current runtime and release discipline for the
project after the first engineering hardening pass.

## Core runtime expectations

- critical reads stay read-only and machine-readable
- sync and write paths expose explicit statuses and warning messages
- retries and cooldowns stay bounded and observable
- local development, CI, and deploy use explicit verification gates

## Commands

Run these from the repository root:

```bash
npm run test:reliability
npm run verify:fast
npm run verify:ci
npm run smoke:local
npm run verify:prod
```

- `test:reliability`: focused contract, workspace, cache, and health checks
- `verify:fast`: lint, typecheck, and the focused reliability suite during active development
- `verify:ci`: lint, typecheck, tests, and build
- `smoke:local`: quick local backend and frontend availability check
- `verify:prod`: machine-readable production health verification plus frontend shell availability

## Reliability checklist

### Retry, timeout, and idempotency

- define whether a failure is retryable or terminal
- keep retry delays explicit and bounded
- prefer machine-readable retry metadata such as retry-after or cooldown values
- make repeated writes safe whenever possible
- do not hide retries inside user-facing read paths

### Failure visibility

- record enough data to explain the last failure
- keep warning lists deduplicated
- expose machine-readable health and lane telemetry instead of text-only summaries
- preserve request identifiers or rate-limit metadata when available

### Freshness and staleness

- prefer explicit snapshot freshness fields over UI heuristics
- document exact vs fallback read behavior in contracts
- keep stale reads acceptable only when the contract says why they are stale

### Cache and invalidation

- keep request identity canonical
- invalidate all affected slices together after writes
- treat optimistic UI as a temporary projection that must reconcile cleanly

## Release discipline

### Before deploy

1. Run `npm run verify:ci`.
2. Review whether the change touches contracts, retries, cooldowns, or write paths.
3. Confirm any compatibility or backfill note is documented if persisted meaning changed.

### During deploy

- `scripts/deploy-prod.sh` now runs `npm run verify:ci` by default before packaging artifacts
- when using `DEPLOY_SKIP_VERIFY=1`, also set `DEPLOY_SKIP_VERIFY_REASON` and use it only when reusing already-verified artifacts intentionally
- after rollout, `scripts/deploy-prod.sh` finishes with `npm run verify:prod` instead of trusting one raw health `curl`

### After deploy

1. Run `npm run verify:prod`.
2. Check the health payload for environment and configuration signals.
3. If the change touched sync or write behavior, inspect the related warnings, telemetry, or recent logs.

## Rollback baseline

If a deploy is unhealthy:

1. stop introducing more changes
2. restore the previous backend or frontend artifact set on the server
3. restart PM2 with the last known good build
4. run the local and public health checks again
5. document whether the issue came from code, config, or persisted data shape
