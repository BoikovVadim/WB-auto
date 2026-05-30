import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, UseGuards } from "@nestjs/common";

import { WbClustersWriteGuard } from "../common/guards/wb-clusters-write.guard";
import { AcquiringSyncService } from "./acquiring-sync.service";
import { SetSubjectCommissionDto } from "./dto/set-subject-commission.dto";
import { SetGlobalPercentDto } from "./dto/set-global-percent.dto";
import { UnitEconomicsService } from "./unit-economics.service";

/**
 * Роуты настроек юнит-экономики (комиссия по предметам + эквайринг) и производных
 * сумм в ₽ на товар. Отдельный контроллер, чтобы не раздувать god-WbClustersController.
 */
@Controller("wb-clusters/unit-economics")
export class UnitEconomicsController {
  constructor(
    @Inject(UnitEconomicsService)
    private readonly unitEconomicsService: UnitEconomicsService,
    @Inject(AcquiringSyncService)
    private readonly acquiringSyncService: AcquiringSyncService,
  ) {}

  /** Предметы каталога с их комиссией (% или null) + глобальный эквайринг. */
  @Get("settings")
  getSettings() {
    return this.unitEconomicsService.getSettings();
  }

  /** Комиссия и эквайринг в ₽ на каждый товар (для колонок таблицы юнит-экономики). */
  @Get("charges")
  getCharges() {
    return this.unitEconomicsService.getCharges();
  }

  /** Ретроспектива эквайринга: товары × отчётные недели (для листа VirtualMatrixTable). */
  @Get("acquiring-matrix")
  getAcquiringMatrix() {
    return this.unitEconomicsService.getAcquiringMatrix();
  }

  /**
   * Ручной запуск синка эквайринга из отчёта реализации (fire-and-forget). days —
   * глубина бэкфилла в днях (по умолчанию 21 = последняя закрытая неделя; для истории
   * ретроспективы — например 180). Возвращается сразу, синк идёт в фоне.
   */
  @Post("sync-acquiring")
  @UseGuards(WbClustersWriteGuard)
  @HttpCode(202)
  syncAcquiring(@Query("days") days?: string) {
    const parsed = Number(days);
    const daysBack = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 400) : 21;
    void this.acquiringSyncService
      .syncAcquiringFromRealization(daysBack)
      .catch(() => {
        /* ошибки логируются внутри сервиса */
      });
    return { status: "started", daysBack };
  }

  @Put("subject-commission")
  @UseGuards(WbClustersWriteGuard)
  setSubjectCommission(@Body() body: SetSubjectCommissionDto) {
    return this.unitEconomicsService.setSubjectCommission(body.subject, body.commissionPercent);
  }

  @Delete("subject-commission")
  @UseGuards(WbClustersWriteGuard)
  @HttpCode(204)
  async clearSubjectCommission(@Query("subject") subject: string) {
    await this.unitEconomicsService.clearSubjectCommission(subject);
  }

  /** Глобальная %-метрика юнит-экономики (acquiring/drr): value=null очищает. */
  @Put("global-percent/:metric")
  @UseGuards(WbClustersWriteGuard)
  setGlobalPercent(@Param("metric") metric: string, @Body() body: SetGlobalPercentDto) {
    return this.unitEconomicsService.setGlobalPercent(metric, body.value);
  }
}
