import { IsDateString, IsOptional } from "class-validator";

import { IsValidDateRange } from "../../common/validators/date-range.validator";

@IsValidDateRange()
export class GetProductWorkspaceDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
