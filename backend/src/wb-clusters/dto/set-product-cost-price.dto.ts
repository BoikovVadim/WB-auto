import { IsNumber, Min } from "class-validator";

export class SetProductCostPriceDto {
  @IsNumber()
  @Min(0)
  costValue!: number;
}
