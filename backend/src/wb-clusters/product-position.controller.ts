import { Controller, Get, Param, ParseIntPipe, Post, Query } from "@nestjs/common";

import { ProductPositionService } from "./product-position.service";

/**
 * Роуты «место товара в выдаче по кластеру» (v1, ручной запуск парсера, 1 IP).
 * Сиблинг WbClustersController/ProductCpoController (god-файл не трогаем).
 */
@Controller("wb-clusters/products")
export class ProductPositionController {
  constructor(private readonly productPositionService: ProductPositionService) {}

  /** Запустить обход позиций по товару (фоновый, статус читать через GET). */
  @Post(":nmId/positions/run")
  run(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Query("limit") limit?: string,
  ) {
    const parsed = limit !== undefined ? Number.parseInt(limit, 10) : undefined;
    return this.productPositionService.startRun(
      nmId,
      Number.isFinite(parsed) ? parsed : undefined,
    );
  }

  /** Статус обхода + последние замеры мест по кластерам товара. */
  @Get(":nmId/positions")
  status(@Param("nmId", ParseIntPipe) nmId: number) {
    return this.productPositionService.getStatus(nmId);
  }
}
