import { IsDateString, IsInt, Min } from "class-validator";

export class GetProductSearchTextsRangeDto {
  @IsInt()
  @Min(1)
  nmId!: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
