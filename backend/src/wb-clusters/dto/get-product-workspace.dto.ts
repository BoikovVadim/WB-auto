import { IsDateString, IsOptional } from "class-validator";

export class GetProductWorkspaceDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
