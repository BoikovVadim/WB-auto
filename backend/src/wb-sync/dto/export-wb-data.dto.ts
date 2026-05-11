import { IsIn, IsObject, IsOptional, IsString } from "class-validator";

import { syncEntities, type SyncEntity } from "../wb-sync.types";

export class ExportWbDataDto {
  @IsString()
  @IsIn(syncEntities)
  entityType!: SyncEntity;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsObject()
  customPayload?: Record<string, unknown>;
}
