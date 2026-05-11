import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
} from "class-validator";

import type { ProductAdvertisingClusterAction } from "../wb-clusters.types";

const validActions = ["include", "exclude"] as const;

export class ApplyProductClusterActionDto {
  @IsString()
  @IsIn(validActions)
  action!: ProductAdvertisingClusterAction;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  clusterNames!: string[];
}
