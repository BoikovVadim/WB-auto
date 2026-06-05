import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";

import { ProductPositionService } from "./product-position.service";

/**
 * Роуты «место товара в выдаче по кластеру» (v1, ручной замер, 1 IP).
 * Замер делается по одному кластеру; глобальный обход оркестрирует фронт по текущему
 * порядку таблицы. Сиблинг WbClustersController/ProductCpoController.
 */
@Controller("wb-clusters/products")
export class ProductPositionController {
  constructor(private readonly productPositionService: ProductPositionService) {}

  /** Последние замеры мест по всем кластерам товара. */
  @Get(":nmId/positions")
  async getPositions(@Param("nmId", ParseIntPipe) nmId: number) {
    const items = await this.productPositionService.getLatestPositions(nmId);
    return { nmId, items };
  }

  /** Замерить место товара по одному кластеру (синхронно, возвращает свежий снапшот). */
  @Post(":nmId/positions/run-cluster")
  runCluster(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Query("clusterName") clusterName?: string,
  ) {
    const name = clusterName?.trim();
    if (!name) throw new BadRequestException("clusterName is required");
    return this.productPositionService.probeCluster(nmId, name);
  }
}
