# WB-Automation → Oqqi · Описание проекта (handover)

Платформа автоматизации Wildberries: синк заказов/продаж/рекламы из API WB, управление
рекламными кампаниями (вкл/выкл кластеров, ставки CPM), юнит-экономика, дашборд товаров.

## 1. Стек / рантайм

- **Backend:** Node.js (LTS 20/22; разрабатывалось на @types/node 24 — подойдёт Node ≥ 20),
  TypeScript 5.9, **NestJS 11** на Express. Кроны — `@nestjs/schedule` (in-process).
  Скрапинг кабинета WB — **Playwright** (headless Chromium).
- **Frontend:** React 18 + **Vite**, TypeScript, axios, `@tanstack/react-virtual`
  (2D-виртуализация широких таблиц). Билд — статика, раздаётся за reverse-proxy.
- **Монорепо** npm workspaces: `backend/` и `Frontend/`.
- **Процесс-менеджер на проде:** PM2 (`ecosystem.config.js`), один процесс
  `wb-automation-backend` → `backend/dist/main.js`. Кроны живут внутри этого процесса.

### Локальный запуск

```bash
npm install                 # ставит оба workspace
npx playwright install chromium   # для скрапинга кабинета (на сервере: --with-deps)
cp .env.example .env        # заполнить значения (см. §5)
npm run dev                 # backend (NestJS) + frontend (Vite) параллельно
# либо по отдельности:
npm run dev:backend         # NestJS, порт BACKEND_PORT
npm run dev:frontend        # Vite, http://localhost:5173
```

### Прод-сборка / запуск

```bash
npm run build               # tsc backend + vite build frontend
node backend/dist/main.js   # или через PM2: pm2 start ecosystem.config.js
```

## 2. Зависимости

- Манифесты: корневой `package.json` (workspaces), `backend/package.json`,
  `Frontend/package.json`. Lock — `package-lock.json` в корне.
- **Системные пакеты:** Chromium-зависимости для Playwright
  (`npx playwright install --with-deps chromium` на Debian/Ubuntu). Больше ничего
  системного не нужно (никаких ffmpeg/poppler).

## 3. Контейнеризация

**Dockerfile / docker-compose НЕТ** — контейнеризуйте у себя. Запуск тривиальный:
сборка `npm run build`, старт `node backend/dist/main.js`, фронт — статика из
`Frontend/dist`. Backend слушает `BACKEND_PORT` с глобальным префиксом `/api`.
На проде стоит за reverse-proxy на префиксе `/wb` (так health = `/wb/api/health`);
на новом домене `sales.oqqi.io` префикс можно убрать — фронт берёт базу из
`VITE_API_BASE_URL`.

## 4. База данных

- **PostgreSQL 16** (один инстанс), подключение через `DATABASE_URL`. Драйвер `pg`.
- Схема создаётся/мигрируется **самим приложением при старте** (ensureSchema —
  идемпотентные `CREATE TABLE / ALTER ADD COLUMN`), отдельных миграционных файлов нет.
  Пустую БД приложение поднимет само; для переноса истории нужен дамп.
- **Полная БД на проде ~45 ГБ**, из них ~44 ГБ — 5 регенерируемых таблиц
  (сырьё/скрап-история/снапшоты, накапливаются синком заново). Бизнес-ядро — ~1.5 ГБ.
- Поставка дампа в два слоя:
  1. **`oqqi-db-core.dump` (~205 МБ, custom-формат `-Fc`, готов)** — полная схема всех
     55 таблиц + данные всех бизнес-таблиц. 5 крупных таблиц включены **со схемой, но
     без данных** (`--exclude-table-data`) — они пустыми восстановятся и наполнятся
     синком. Снят с `--no-owner --no-privileges` → разворачивается в любую роль.
     ⚠️ Содержит ПД (заказы: имена/телефоны) → только защищённый канал, РФ-регион.
  2. **Объёмные таблицы (~29 ГБ:** `wb_cabinet_cluster_queries`,
     `wb_product_workspace_cluster_queries`, `wb_query_frequency_history`,
     `wb_product_advertising_sheet_snapshots`; + `wb_cluster_raw_archive` 15 ГБ —
     эту вообще не переносим, retention 7 дней). Их историю при желании переносим
     **server-to-server напрямую в БД Oqqi** (`pg_dump … | psql …`), когда будет
     приёмник — не гоняя 30 ГБ через ноут. По умолчанию можно стартовать без них.

### Восстановление core-дампа

```bash
createdb wb_automation
pg_restore --no-owner --no-privileges -d wb_automation oqqi-db-core.dump
# (предупреждения про отсутствующие роли/расширения при --no-owner — норма)
```
- Ключевые таблицы (бизнес-данные): заказы/продажи, дневной расход рекламы
  (`wb_advert_daily_spend`), эквайринг (`wb_product_acquiring_weekly`), юнит-экономика
  и комиссии по предметам, состав/числа рекламных кластеров, накопители решений движка,
  change-log авто-действий рекламы.

## 5. Переменные окружения (ИМЕНА, без значений)

Полный шаблон — в репозитории: **`.env.example`** (backend) и **`.env.deploy.example`**
(деплой). Значения там — плейсхолдеры (`replace-me`), реальных секретов в репо нет.
Критичные секреты (залить в Yandex Lockbox по защищённому каналу):

- `WB_API_TOKEN` — токен WB Seller/Statistics API
- `WB_PROMOTION_API_TOKEN` — токен WB Promotion/Advert API
- `DATABASE_URL` — строка подключения к Postgres (содержит пароль)

Остальные (несекретные, режимы/тайминги/лимиты — значения см. в `.env.example`):
`NODE_ENV`, `BACKEND_PORT`, `FRONTEND_ORIGIN`, `VITE_API_BASE_URL`, `PGSSL`, `PGSCHEMA`,
семейство `WB_API_*`, `WB_PROMOTION_*`, `WB_STATISTICS_API_*`, `WB_ORDERS_SYNC_*`,
`WB_CABINET_*` (headless-скрапинг кабинета), `WB_ARCHIVE_ROOT`.

## 6. Внешние интеграции

Только **исходящие** вызовы к Wildberries (входящих вебхуков НЕТ — архитектура
polling/cron):

- **WB Seller Analytics API** (`seller-analytics-api.wildberries.ru`)
- **WB Statistics API** (`statistics-api.wildberries.ru`) — заказы/продажи, лимит 1 req/min
- **WB Promotion/Advert API** (`advert-api.wildberries.ru`) — кампании, ставки, статистика
- **Кабинет WB** (`cmp.wildberries.ru`) — состав кластеров/частоты, через headless
  Playwright (`WB_CABINET_*`).

> ⚠️ **Важно для переноса:** часть обновления данных кабинета исторически крутилась
> на Mac через launchd + Safari-автоматизацию (TCC-ограничения). На Linux-сервере это
> надо вести **только headless-путём Playwright** (`WB_CABINET_HEADLESS=true`,
> установить Chromium с зависимостями). Mac-launchd-агенты на новый сервер не переносятся —
> их роль берёт on-server headless-крон. Готов помочь донастроить.

## 7. Health-эндпоинт

Есть: **`GET /api/health`** (за прокси на проде — `GET /wb/api/health`).
Используется в `npm run health:prod` и деплой-хелсчеке.

## 8. Объём данных

Кодовая база лёгкая (бандл ~1.9 МБ). Тяжёлый только Postgres-дамп — за счёт
`raw_archive` (см. §4); бизнес-данные сами по себе компактны. Медиа/ML-моделей нет.

## 9. Развёртывание на sales.oqqi.io (нюансы reverse-proxy)

На проде сейчас: nginx раздаёт статику фронта и проксирует API на backend (PM2, порт
3300). Под Oqqi нужно воспроизвести в вашем прокси (Caddy/Traefik с авто-HTTPS):

- **Backend** слушает `BACKEND_PORT` (на проде 3300), глобальный префикс **`/api`**.
- **Health:** `GET <backend>/api/health`.
- **Префикс пути.** Фронт сейчас собран под подпуть **`/wb/`** (`vite base: "/wb/"`,
  `outDir: Frontend/build`). На отдельном домене `sales.oqqi.io` (корень) — **либо**
  поменять `base` на `/` в `Frontend/vite.config.ts` и пересобрать (чище), **либо**
  оставить и отдавать на `sales.oqqi.io/wb` (быстрее). API-базу фронт берёт из
  `VITE_API_BASE_URL` (если задана) или относительным путём.
- **Обязательные параметры прокси** (иначе ломается функционал):
  - `client_max_body_size 10m` — сейв фильтров кластеров шлёт большие тела (дефолтные
    1–2 МБ → 413).
  - `proxy_read_timeout 120s` — тяжёлые синки/выгрузки.
  - статика `assets/` — `Cache-Control: immutable, 1y`; `index.html` — `no-store`.

Минимальный прод-старт (без контейнера): `npm ci && npm run build` →
`node backend/dist/main.js` под PM2 (`ecosystem.config.js`) + прокси раздаёт
`Frontend/build/` и проксирует `*/api/*` на backend. Кроны поднимаются внутри
backend-процесса автоматически (`@nestjs/schedule`) — отдельный cron-демон не нужен.

> 🛟 **Первый запуск рядом с боевым — только чтение.** Проект активно ПИШЕТ в кабинет
> WB (вкл/выкл кластеров, ставки CPM, DRR-регулятор). Нельзя, чтобы старый и новый
> экземпляр писали в один кабинет одновременно. Поэтому новый экземпляр поднимаем с
> **`WB_AUTOMATION_READ_ONLY=true`** — все автодвижки считают и пишут в свою БД, но в WB
> ничего не отправляют. После cutover (старый остановлен) ставим `false`.

---

## Что в поставке

- `oqqi-sales.bundle` (~1.9 МБ) — весь репозиторий со всей историей (`git bundle … --all`),
  `git bundle verify` — OK, полная история, ветка `main` (+ рабочая фича-ветка).
- `oqqi-db-core.dump` (~205 МБ) — core-дамп БД (см. §4). **Передать по защищённому
  каналу** (ПД, 152-ФЗ), не в общий чат.
- Этот файл `PROJECT-HANDOVER.md`.
- Секреты (`WB_API_TOKEN`, `WB_PROMOTION_API_TOKEN`, новый `DATABASE_URL`) — в Lockbox
  по отдельному каналу.
