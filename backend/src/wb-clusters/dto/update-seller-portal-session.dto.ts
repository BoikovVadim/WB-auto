import { IsArray, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class LocalStorageItemDto {
  @IsString()
  name!: string;

  @IsString()
  value!: string;
}

export class UpdateSellerPortalSessionDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocalStorageItemDto)
  localStorage!: LocalStorageItemDto[];
}
