import { IsDateString, IsOptional } from "class-validator";

import { IsValidDateRange } from "../../common/validators/date-range.validator";

@IsValidDateRange()
export class GetProductAdvertisingSheetDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
