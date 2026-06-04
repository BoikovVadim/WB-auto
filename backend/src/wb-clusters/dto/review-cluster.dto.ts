import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

const REVIEW_ACTIONS = ["approve", "reject", "protect"] as const;

/** Ручная модерация нового кластера: в работу | в чёрный список | защитить. */
export class ReviewClusterDto {
  /** Нормализованное имя кластера (ключ строки состояния автоматики). */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  normalizedClusterName!: string;

  /** Отображаемое имя кластера (для записи в override при reject/protect). */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  clusterName!: string;

  @IsIn(REVIEW_ACTIONS)
  action!: (typeof REVIEW_ACTIONS)[number];
}
