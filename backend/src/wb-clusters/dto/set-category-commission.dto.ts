import { IsNumber, IsString, Max, Min, MinLength } from "class-validator";

export class SetCategoryCommissionDto {
  @IsString()
  @MinLength(1)
  category!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPercent!: number;
}
