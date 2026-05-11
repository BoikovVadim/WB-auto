# AGENTS.md

Router-file for the Wildberries automation project. Pick the bounded context first, then read the smallest doc or code surface that answers the task.

## Start here

1. Read `README.md` for product scope, run commands, and current MVP.
2. Read `docs/module-map.md` to choose the exact module before searching code.
3. Open deeper docs only when needed:
   - `docs/module-map.md` for code routing
   - `.cursor/rules/*.mdc` for permanent project rules
4. Only after that, use focused reads in the chosen module.

## Project snapshot

- Status: `BOOTSTRAP`
- Stack: `NestJS + TypeScript` backend, `React + Vite + TypeScript` frontend
- Goal: automate `WB API` data export, transformation, and safe write-back

## Primary bounded contexts

- `wb-sync`
- `wb-clusters`
- `catalog`
- `pricing`
- `stocks`
- `orders`
- `analytics`
- `audit`

## Routing by task type

| Task type | Read first | Then go to |
| --- | --- | --- |
| `WB API integration` | `README.md`, `docs/module-map.md` | `backend/src/wb-sync/**`, `backend/src/common/env.ts` |
| `product advertising / product snapshots` | `README.md`, `docs/module-map.md` | `backend/src/wb-clusters/**`, `Frontend/src/features/dashboard/advertising/**`, `Frontend/src/features/dashboard/useDashboardBootstrap.ts`, `Frontend/src/features/dashboard/useDashboardProductSelection.ts`, `Frontend/src/features/dashboard/useDashboardProductsMode.ts`, `Frontend/src/api/**` |
| `price or stock rules` | `docs/module-map.md` | `backend/src/pricing/**`, `backend/src/stocks/**` |
| `admin dashboard` | `docs/module-map.md` | `Frontend/src/features/**`, `Frontend/src/api/**` |
| `project rules / architecture` | `.cursor/rules/*.mdc` | `README.md`, `docs/module-map.md` |

## Memory note rule

When a task creates a durable architecture or integration decision, update `README.md`, `docs/module-map.md`, or the relevant rule file in `.cursor/rules/`.
