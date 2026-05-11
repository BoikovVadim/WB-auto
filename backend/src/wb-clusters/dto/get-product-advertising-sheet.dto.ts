import { IsDateString, IsOptional } from "class-validator";

export class GetProductAdvertisingSheetDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
