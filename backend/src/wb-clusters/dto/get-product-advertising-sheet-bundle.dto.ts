import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  Min,
} from "class-validator";

export class GetProductAdvertisingSheetBundleDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @IsInt({ each: true })
  @Min(1, { each: true })
  nmIds!: number[];
}
