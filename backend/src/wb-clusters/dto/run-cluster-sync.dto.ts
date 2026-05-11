import { IsIn, IsOptional, IsString } from "class-validator";

import type { ClusterSyncMode, ClusterSyncTrigger } from "../wb-clusters.types";

const validTriggers = ["manual", "schedule", "bootstrap"] as const;
const validModes = ["full", "inventory", "structure", "stats"] as const;

export class RunClusterSyncDto {
  @IsOptional()
  @IsString()
  @IsIn(validTriggers)
  trigger?: ClusterSyncTrigger;

  @IsOptional()
  @IsString()
  @IsIn(validModes)
  mode?: ClusterSyncMode;
}
