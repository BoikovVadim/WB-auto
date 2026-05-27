import { IsIn, IsObject, IsOptional, IsString } from "class-validator";

import { MaxJsonSize } from "../../common/validators/max-json-size.validator";
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
  @MaxJsonSize(100_000)
  customPayload?: Record<string, unknown>;
}
