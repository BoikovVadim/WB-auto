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
        NODE_OPTIONS: "--max-old-space-size=768",
      },
      instances: 1,
      exec_mode: "fork",
      wait_ready: false,
      listen_timeout: 15000,
      kill_timeout: 10000,
      autorestart: true,
      max_memory_restart: "900M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
