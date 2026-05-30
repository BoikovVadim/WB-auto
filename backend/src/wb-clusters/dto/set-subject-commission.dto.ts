import { IsNumber, IsString, Max, Min, MinLength } from "class-validator";

/** Установка комиссии (%) для предмета (subjectName) каталога. */
export class SetSubjectCommissionDto {
  @IsString()
  @MinLength(1)
  subject!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPercent!: number;
}
