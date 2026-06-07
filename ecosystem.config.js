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
        // Движок кластеров v2 (накопители по ценовой корзине + фаза LEARNING).
        // V2=1 без V2_LIVE — ОБКАТКА: товары в режиме preview считаются по v2 (WB не
        // трогается), товары в live остаются на v1. Для боевого эффекта на live-товары
        // добавить WB_CLUSTER_DECISION_V2_LIVE: "1" (и WB_CLUSTER_DRR_REGULATOR: "1" —
        // регулятор дневного ДРР). См. product-cluster-decision.v2.ts.
        WB_CLUSTER_DECISION_V2: "1",
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
