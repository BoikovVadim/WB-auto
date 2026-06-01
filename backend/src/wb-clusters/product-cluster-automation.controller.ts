import { Body, Controller, Get, Param, ParseIntPipe, Put, UseGuards } from "@nestjs/common";

import { WbClustersWriteGuard } from "../common/guards/wb-clusters-write.guard";
import { ProductClusterAutomationService } from "./product-cluster-automation.service";
import { SetAutomationModeDto } from "./dto/set-automation-mode.dto";

/**
 * Роуты автоматизации управления кластерами по CPO (вкладка «Реклама»). Сиблинг
 * WbClustersController (тот god-файл не трогаем). GET — чтение статуса/решений (без guard);
 * PUT — смена режима (off/preview/live), под write-guard, т.к. live-режим меняет боевые РК.
 */
@Controller("wb-clusters/products")
export class ProductClusterAutomationController {
  constructor(private readonly service: ProductClusterAutomationService) {}

  /** Статус автоматизации кампании + per-cluster решения (для бейджей в таблице). */
  @Get(":nmId/campaigns/:advertId/automation")
  getStatus(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Param("advertId", ParseIntPipe) advertId: number,
  ) {
    return this.service.getStatus(advertId, nmId);
  }

  /** Сменить режим автоматизации кампании (off | preview | live). */
  @Put(":nmId/campaigns/:advertId/automation")
  @UseGuards(WbClustersWriteGuard)
  async setMode(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Param("advertId", ParseIntPipe) advertId: number,
    @Body() body: SetAutomationModeDto,
  ) {
    await this.service.setMode(advertId, nmId, body.mode);
    return this.service.getStatus(advertId, nmId);
  }
}
