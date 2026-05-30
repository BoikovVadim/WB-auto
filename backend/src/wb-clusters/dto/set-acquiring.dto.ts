import { IsNumber, Max, Min, ValidateIf } from "class-validator";

export class SetAcquiringDto {
  // null очищает эквайринг; иначе процент 0..100.
  @ValidateIf((o: SetAcquiringDto) => o.acquiringPercent !== null)
  @IsNumber()
  @Min(0)
  @Max(100)
  acquiringPercent!: number | null;
}
