import { IsIn, IsOptional, IsString } from "class-validator";
import { syncEntities, type SyncEntity } from "../wb-sync.types";

export class RunSyncDto {
  @IsOptional()
  @IsString()
  @IsIn(syncEntities)
  entityType?: SyncEntity;
}
