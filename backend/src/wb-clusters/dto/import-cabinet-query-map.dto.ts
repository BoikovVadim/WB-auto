import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";

class CabinetQueryMapRowDto {
  @IsString()
  clusterName!: string;

  @IsString()
  queryText!: string;
}

export class ImportCabinetQueryMapDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  advertId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  nmId!: number;

  @IsDateString()
  capturedAt!: string;

  @IsOptional()
  @IsString()
  captureMode?: string;

  @IsOptional()
  @IsString()
  sourceEndpoint?: string;

  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;

  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(20000)
  @ValidateNested({ each: true })
  @Type(() => CabinetQueryMapRowDto)
  rows!: CabinetQueryMapRowDto[];
}
