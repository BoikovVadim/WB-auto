import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsInt, IsNumber, ValidateNested } from "class-validator";

/** Строка калькулятора «целевая маржа → нужная цена». */
class MarginToPriceItemDto {
  @Type(() => Number)
  @IsInt()
  nmId!: number;

  @Type(() => Number)
  @IsNumber()
  targetMarginPercent!: number;
}

/** Строка калькулятора «цена → маржа %». */
class PriceToMarginItemDto {
  @Type(() => Number)
  @IsInt()
  nmId!: number;

  @Type(() => Number)
  @IsNumber()
  price!: number;
}

/**
 * Вход батч-калькулятора юнит-экономики: пользователь вводит per-товар целевую маржу
 * и/или гипотетическую цену, сервер считает обратную величину на едином базисе.
 */
export class UnitEconomicsCalcDto {
  @IsArray()
  @ArrayMaxSize(20000)
  @ValidateNested({ each: true })
  @Type(() => MarginToPriceItemDto)
  marginToPrice: MarginToPriceItemDto[] = [];

  @IsArray()
  @ArrayMaxSize(20000)
  @ValidateNested({ each: true })
  @Type(() => PriceToMarginItemDto)
  priceToMargin: PriceToMarginItemDto[] = [];
}
