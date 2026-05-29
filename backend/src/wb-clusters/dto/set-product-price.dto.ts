import { IsNumber, Min } from "class-validator";

/**
 * Тело PUT .../price. `targetFinal` — желаемая цена «со скидкой» (итог на витрине).
 * Базовая цена вычисляется на сервере обратным пересчётом, скидка не меняется.
 */
export class SetProductPriceDto {
  @IsNumber()
  @Min(1)
  targetFinal!: number;
}
