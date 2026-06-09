import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class ProductClusterBidChangeDto {
  @IsString()
  @MaxLength(255)
  clusterName!: string;

  // WB принимает CPM только целым — дробная ставка отвергается ("incorrect request
  // body") и роняет весь батч. Не пропускаем дробное даже на входе контракта.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bid!: number;
}

export class ApplyProductClusterBidDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProductClusterBidChangeDto)
  bids!: ProductClusterBidChangeDto[];
}
