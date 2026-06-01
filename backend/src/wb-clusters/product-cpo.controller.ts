import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";

import { ProductCpoService } from "./product-cpo.service";

/**
 * Роуты CPO (макс. цена за заказ) для таблицы товаров. Сиблинг WbClustersController
 * (тот не трогаем — god-файл >500 строк). Только чтение, без write-guard.
 */
@Controller("wb-clusters/products")
export class ProductCpoController {
  constructor(private readonly productCpoService: ProductCpoService) {}

  /** Сегодняшний CPO по товарам ((выручка / заказы) × ДРР%). */
  @Get("cpo-today")
  getTodayCpo() {
    return this.productCpoService.getTodayCpo();
  }

  /** Матрица "товары × даты" CPO ((выручка / заказы) × ДРР% за тот же день, ₽). */
  @Get("cpo-matrix-compact")
  getCpoMatrixCompact() {
    return this.productCpoService.getCpoMatrixCompact();
  }

  /** CPO одного товара + максимальная планка maxCpo (= CPO × 2) для шапки рекламного воркспейса. */
  @Get(":nmId/cpo")
  getProductCpo(@Param("nmId", ParseIntPipe) nmId: number) {
    return this.productCpoService.getProductCpo(nmId);
  }
}
