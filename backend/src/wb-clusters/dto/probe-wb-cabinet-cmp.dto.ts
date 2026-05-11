import { Type } from "class-transformer";
import { IsInt, Min } from "class-validator";

export class ProbeWbCabinetCmpDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  advertId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  nmId!: number;
}
