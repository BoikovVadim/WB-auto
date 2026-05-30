import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put, Query, UseGuards } from "@nestjs/common";

import { WbClustersWriteGuard } from "../common/guards/wb-clusters-write.guard";
import { SetCategoryCommissionDto } from "./dto/set-category-commission.dto";
import { SetGlobalPercentDto } from "./dto/set-global-percent.dto";
import { UnitEconomicsService } from "./unit-economics.service";

/**
 * Роуты настроек юнит-экономики (комиссия по категориям + эквайринг) и производных
 * сумм в ₽ на товар. Отдельный контроллер, чтобы не раздувать god-WbClustersController.
 */
@Controller("wb-clusters/unit-economics")
export class UnitEconomicsController {
  constructor(
    @Inject(UnitEconomicsService)
    private readonly unitEconomicsService: UnitEconomicsService,
  ) {}

  /** Категории каталога с их комиссией (% или null) + глобальный эквайринг. */
  @Get("settings")
  getSettings() {
    return this.unitEconomicsService.getSettings();
  }

  /** Комиссия и эквайринг в ₽ на каждый товар (для колонок таблицы юнит-экономики). */
  @Get("charges")
  getCharges() {
    return this.unitEconomicsService.getCharges();
  }

  @Put("category-commission")
  @UseGuards(WbClustersWriteGuard)
  setCategoryCommission(@Body() body: SetCategoryCommissionDto) {
    return this.unitEconomicsService.setCategoryCommission(body.category, body.commissionPercent);
  }

  @Delete("category-commission")
  @UseGuards(WbClustersWriteGuard)
  @HttpCode(204)
  async clearCategoryCommission(@Query("category") category: string) {
    await this.unitEconomicsService.clearCategoryCommission(category);
  }

  /** Глобальная %-метрика юнит-экономики (acquiring/drr): value=null очищает. */
  @Put("global-percent/:metric")
  @UseGuards(WbClustersWriteGuard)
  setGlobalPercent(@Param("metric") metric: string, @Body() body: SetGlobalPercentDto) {
    return this.unitEconomicsService.setGlobalPercent(metric, body.value);
  }
}
