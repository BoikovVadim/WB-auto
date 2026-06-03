import { Body, Controller, Get, Param, ParseIntPipe, Put, UseGuards } from "@nestjs/common";

import { WbClustersWriteGuard } from "../common/guards/wb-clusters-write.guard";
import { ProductClusterAutomationService } from "./product-cluster-automation.service";
import { SetAutomationModeDto } from "./dto/set-automation-mode.dto";
import { SetClusterFiltersDto } from "./dto/set-cluster-filters.dto";

/**
 * Роуты автоматизации управления кластерами по CPO (вкладка «Реклама»). Сиблинг
 * WbClustersController (тот god-файл не трогаем). GET — чтение статуса/решений (без guard);
 * PUT — смена режима (off/preview/live), под write-guard, т.к. live-режим меняет боевые РК.
 */
@Controller("wb-clusters/products")
export class ProductClusterAutomationController {
  constructor(private readonly service: ProductClusterAutomationService) {}

  /** Сводный статус автоматизации по всем товарам — для колонки в таблице товаров. */
  @Get("automation-status")
  getProductAutomationStatuses() {
    return this.service.getProductAutomationStatuses();
  }

  /** Детализация автоматизации по товару (режим + кампании + счётчики) — для модалки из таблицы товаров. */
  @Get(":nmId/automation")
  getProductAutomationDetail(@Param("nmId", ParseIntPipe) nmId: number) {
    return this.service.getProductAutomationDetail(nmId);
  }

  /** Сменить режим автоматизации сразу для всех кампаний товара (off | preview | live). */
  @Put(":nmId/automation")
  @UseGuards(WbClustersWriteGuard)
  setProductMode(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Body() body: SetAutomationModeDto,
  ) {
    return this.service.setProductMode(nmId, body.mode);
  }

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

  /** Настройка фильтров: список кластеров + флаги защиты (для модалки). */
  @Get(":nmId/campaigns/:advertId/automation/config")
  getFilterConfig(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Param("advertId", ParseIntPipe) advertId: number,
  ) {
    return this.service.getFilterConfig(advertId, nmId);
  }

  /**
   * Полная замена белого (нельзя выключать) и чёрного (нельзя включать) списков.
   * Чёрный приоритетнее белого, оба — приоритетнее CPO-правила.
   */
  @Put(":nmId/campaigns/:advertId/automation/config")
  @UseGuards(WbClustersWriteGuard)
  setFilterConfig(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Param("advertId", ParseIntPipe) advertId: number,
    @Body() body: SetClusterFiltersDto,
  ) {
    return this.service.setClusterFilters(advertId, nmId, {
      protected: body.protected,
      blacklisted: body.blacklisted,
    });
  }
}
