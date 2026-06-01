import { Type } from "class-transformer";
import { IsArray, IsString, MinLength, ValidateNested } from "class-validator";

/** Один защищённый кластер: нормализованное имя (ключ) + отображаемое имя. */
export class ProtectedClusterDto {
  @IsString()
  @MinLength(1)
  normalizedClusterName!: string;

  @IsString()
  @MinLength(1)
  clusterName!: string;
}

/** Полная замена набора защищённых кластеров кампании (idempotent). */
export class SetClusterFiltersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProtectedClusterDto)
  protected!: ProtectedClusterDto[];
}
