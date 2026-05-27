import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";

export class MaterializeProductAdvertisingSheetsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  nmIds!: number[];

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  exportRequestId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn(["visible", "candidate", "background"])
  priority?: "visible" | "candidate" | "background";
}
