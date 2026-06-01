import { Type } from "class-transformer";
import { IsArray, IsString, MinLength, ValidateNested } from "class-validator";

/** Один кластер в наборе фильтра: нормализованное имя (ключ) + отображаемое имя. */
export class ClusterFilterItemDto {
  @IsString()
  @MinLength(1)
  normalizedClusterName!: string;

  @IsString()
  @MinLength(1)
  clusterName!: string;
}

/**
 * Полная замена наборов белого (protected — нельзя выключать) и чёрного
 * (blacklisted — нельзя включать) списков кампании (idempotent).
 */
export class SetClusterFiltersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClusterFilterItemDto)
  protected!: ClusterFilterItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClusterFilterItemDto)
  blacklisted!: ClusterFilterItemDto[];
}
