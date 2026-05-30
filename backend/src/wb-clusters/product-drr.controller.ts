import { Controller, Get } from "@nestjs/common";

import { ProductDrrService } from "./product-drr.service";

/**
 * Роуты ДРР (доля рекламных расходов) для таблицы товаров. Сиблинг WbClustersController
 * (тот не трогаем — god-файл >500 строк). Только чтение, без write-guard.
 */
@Controller("wb-clusters/products")
export class ProductDrrController {
  constructor(private readonly productDrrService: ProductDrrService) {}

  /** Сегодняшний ДРР по товарам (расход на рекламу / выручка × 100). */
  @Get("drr-today")
  getTodayDrr() {
    return this.productDrrService.getTodayDrr();
  }

  /** Матрица "товары × даты" ДРР (расход / выручка за тот же день, %). */
  @Get("drr-matrix-compact")
  getDrrMatrixCompact() {
    return this.productDrrService.getDrrMatrixCompact();
  }
}
