import { IsNumber, Max, Min, ValidateIf } from "class-validator";

export class SetGlobalPercentDto {
  // null очищает значение метрики; иначе процент 0..100.
  @ValidateIf((o: SetGlobalPercentDto) => o.value !== null)
  @IsNumber()
  @Min(0)
  @Max(100)
  value!: number | null;
}
