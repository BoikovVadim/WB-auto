import { IsString, MinLength } from "class-validator";

export class BootstrapWbCabinetSessionDto {
  @IsString()
  @MinLength(2)
  storageStateJson!: string;
}
