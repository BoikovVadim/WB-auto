# Production deploy

## Canonical topology

- Production directory: `/var/www/wb-automation`
- Backend process manager: `pm2`
- PM2 app name: `wb-automation-backend`
- Backend port behind nginx: `3300`
- Public app URL on the shared domain: `https://legendgames.space/wb/`
- Same-domain nginx health endpoint: `https://legendgames.space/wb/api/health`
- Frontend delivery: static files from `Frontend/build`
- Reverse proxy: shared nginx keeps `/bms/` untouched and adds `/wb/` plus `/wb/api/`
- Export archive persistence: `/var/www/wb-automation/shared/archives/search-queries`
- PostgreSQL for official WB clusters: local server database on the same host

## Required production env

Create a dedicated env file for the WB application:

- `/var/www/wb-automation/shared/.env`

Example:

```bash
NODE_ENV=production
BACKEND_PORT=3300
FRONTEND_ORIGIN=https://legendgames.space
WB_API_BASE_URL=https://seller-analytics-api.wildberries.ru
WB_API_TIMEOUT_MS=20000
WB_DEFAULT_LOCALE=ru
WB_PROMOTION_API_BASE_URL=https://advert-api.wildberries.ru
WB_PROMOTION_API_TIMEOUT_MS=45000
WB_PROMOTION_API_MIN_INTERVAL_MS=300
WB_PROMOTION_API_TOKEN=replace-me
WB_PROMOTION_STATS_LOOKBACK_DAYS=30
WB_PROMOTION_SYNC_ENABLED=true
WB_ARCHIVE_ROOT=/var/www/wb-automation/shared/archives/search-queries
WB_API_TOKEN=replace-me
DATABASE_URL=postgres://postgres:replace-me@127.0.0.1:5432/wb_automation
PGSSL=false
PGSCHEMA=public
```

`WB_ARCHIVE_ROOT` must point to a persistent path outside temporary deploy artifacts.
When the dashboard saves a WB token, the backend writes `WB_API_TOKEN` back into this env file so the token survives process restarts and future deploys.
The same env file should also hold `WB_PROMOTION_API_TOKEN` and PostgreSQL connection settings for the official WB clusters module.

## PM2 runtime

Use the repo `ecosystem.config.js` with:

- app name `wb-automation-backend`
- `cwd=/var/www/wb-automation`
- `BACKEND_PORT=3300`
- single-instance `fork` mode

The single-instance rule is intentional. The current WB token session is stored in process memory, so cluster mode would split runtime token state across workers.

## Canonical server-first deploy profile

```bash
DEPLOY_REMOTE_HOST=95.163.226.154
DEPLOY_REMOTE_USER=root
DEPLOY_REMOTE_DIR=/var/www/wb-automation
DEPLOY_PM2_APP=wb-automation-backend
DEPLOY_HEALTHCHECK_URL=https://legendgames.space/wb/api/health
DEPLOY_SSH_KEY_PATH=~/.ssh/id_ed25519_reg_ru_deploy
```

Preferred commands:

```bash
npm run deploy:server-first:frontend
npm run deploy:server-first:backend
npm run deploy:server-first:auto
npm run deploy:server-first:sync
```

For non-default machines, copy `.env.deploy.example` to `.env.deploy.local` and override only the values that differ.

## Server bootstrap

1. Create directories:
   - `/var/www/wb-automation`
   - `/var/www/wb-automation/shared`
   - `/var/www/wb-automation/shared/archives/search-queries`
2. Install and create PostgreSQL database on the same server:
   - create database `wb_automation`
   - create a dedicated user or use local `postgres`
   - update `DATABASE_URL` in `/var/www/wb-automation/shared/.env`
3. Put the production env file into `/var/www/wb-automation/shared/.env`.
4. On first bootstrap, install workspace dependencies once:
   - `cd /var/www/wb-automation`
   - `npm ci --include=dev --omit=optional`
5. Start PM2:
   - `pm2 start ecosystem.config.js --only wb-automation-backend --update-env`
6. Save PM2 state if needed:
   - `pm2 save`

## Nginx additive integration

Use `deploy/nginx/legendgames.space-wb.conf` as the additive snippet for the shared domain.

Required routes:

- redirect `/wb -> /wb/`
- proxy `/wb/api/* -> 127.0.0.1:3300/api/*`
- serve `/wb/assets/*` from `/var/www/wb-automation/Frontend/build/assets/`
- SPA fallback `/wb/* -> /var/www/wb-automation/Frontend/build/index.html`

The `/bms/` configuration must remain unchanged.

## Deploy commands

- Full deploy: `npm run deploy:prod`
- Auto deploy: `npm run deploy:prod:auto`
- Backend only: `npm run deploy:prod:backend`
- Frontend only: `npm run deploy:prod:frontend`
- Sync-only wrapper: `npm run deploy:prod:sync`
- Canonical server-first auto: `npm run deploy:server-first:auto`

## Verification

Before deploy:

- `npm run verify:ci`
- if you must bypass pre-deploy verification for already-verified artifacts, set both `DEPLOY_SKIP_VERIFY=1` and `DEPLOY_SKIP_VERIFY_REASON="why this reuse is safe"`

After deploy:

- `npm run verify:prod`
- confirm the health payload still reports `status: ok`, `service: wb-automation-backend`, and machine-readable `checks.*` booleans

## Rollback

If the deploy is unhealthy:

1. Stop new deploy attempts until the failure cause is understood.
2. Restore the previous known-good `backend/dist` and/or `Frontend/build` artifact set on the server.
3. Restart PM2 with `pm2 startOrReload ecosystem.config.js --only wb-automation-backend --update-env`.
4. Re-run the local and public health checks.
5. If the issue came from config or persisted data meaning, document the corrective action before the next rollout.

## Migration note

Later migration to a dedicated server should move the whole `/var/www/wb-automation` tree together with:

- `/var/www/wb-automation/shared/.env`
- `/var/www/wb-automation/shared/archives/search-queries`

This keeps internal paths and PM2 layout stable while only changing the host and nginx target.
