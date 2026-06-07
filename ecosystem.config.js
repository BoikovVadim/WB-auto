module.exports = {
  apps: [
    {
      name: "wb-automation-backend",
      script: "backend/dist/main.js",
      cwd: "/var/www/wb-automation",
      env: {
        NODE_ENV: "production",
        BACKEND_PORT: 3300,
        TZ: "Europe/Moscow",
        // Heap 768М не хватало на построение больших матриц товар×дата
        // (расход/выручка/заказы/выкуп/с-с) → FATAL heap OOM и краш бэкенда,
        // в момент рестарта API отваливался. Сервер 3.9G RAM (~2.3G свободно),
        // поднимаем с запасом; max_memory_restart держим выше heap, чтобы pm2
        // мягко рестартил по RSS раньше, чем V8 упрётся в жёсткий heap-лимит.
        NODE_OPTIONS: "--max-old-space-size=1536",
        // Движок кластеров v2 (накопители по ценовой корзине + фаза LEARNING) — БОЕВОЙ.
        // V2=1 — v2 включена; V2_LIVE=1 — на live-товарах v2 реально управляет WB (не только
        // preview); DRR_REGULATOR=1 — регулятор дневного ДРР (excluded_drr). Pending-кластеры
        // движок НЕ трогает (noop) — только подписывает рекомендацию мусор-фильтра, решает
        // человек. См. product-cluster-decision.v2.ts / product-cluster-relevance.ts.
        WB_CLUSTER_DECISION_V2: "1",
        WB_CLUSTER_DECISION_V2_LIVE: "1",
        WB_CLUSTER_DRR_REGULATOR: "1",
      },
      instances: 1,
      exec_mode: "fork",
      wait_ready: false,
      listen_timeout: 15000,
      kill_timeout: 10000,
      autorestart: true,
      max_memory_restart: "1800M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
