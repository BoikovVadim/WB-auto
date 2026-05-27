import { IsDateString, IsInt, Min } from "class-validator";

import { IsValidDateRange } from "../../common/validators/date-range.validator";

@IsValidDateRange()
export class GetProductSearchTextsRangeDto {
  @IsInt()
  @Min(1)
  nmId!: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
