import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { WbSearchPositionProbeClient } from "./wb-search-position-probe.client";

/**
 * Грелка зонда позиций: держит браузерную сессию WB-выдачи тёплой постоянно, чтобы клик
 * по замеру всегда отдавал результат БЕЗ холодного старта (~75с прогрева).
 *
 * Один раз на старте прогревает сессию фоном, дальше каждые TICK_MS делает лёгкий heartbeat
 * (один запрос страницы 1) — освежает cookie мобильного прокси и не даёт idle-close закрыть
 * браузер. Если сессия протухла (heartbeat вернул false) — следующий тик прогреет заново.
 *
 * Включена по умолчанию при заданном WB_SEARCH_PROBE_PROXY; отключить — WB_POSITION_KEEP_WARM=0.
 */
@Injectable()
export class PositionProbeWarmerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PositionProbeWarmerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  /** Heartbeat-интервал < IDLE_CLOSE_MS(10м) клиента — браузер не успевает остыть. */
  private static readonly TICK_MS = 4 * 60_000;
  /** Стабильно популярный запрос: всегда даёт непустую выдачу — годен для прогрева/heartbeat. */
  private static readonly WARM_QUERY = "телефон";

  constructor(private readonly probe: WbSearchPositionProbeClient) {}

  onModuleInit(): void {
    if (process.env.WB_POSITION_KEEP_WARM === "0") return;
    if (!process.env.WB_SEARCH_PROBE_PROXY) {
      this.logger.warn("keep-warm: WB_SEARCH_PROBE_PROXY не задан — грелка не запущена.");
      return;
    }
    this.logger.log("keep-warm: прогрев сессии зонда фоном + heartbeat каждые 4 мин.");
    void this.tick();
    this.timer = setInterval(() => void this.tick(), PositionProbeWarmerService.TICK_MS);
  }

  /** Один проход: прогреть/освежить тёплую сессию. Не накладывается сам на себя. */
  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const ok = await this.probe.heartbeat(PositionProbeWarmerService.WARM_QUERY);
      if (!ok) this.logger.warn("keep-warm: сессия остыла — прогрев заново на следующем тике.");
    } catch (error) {
      this.logger.warn(`keep-warm tick: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
