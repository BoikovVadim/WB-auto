import { IsString, MinLength } from "class-validator";

export class SetWbTokenDto {
  @IsString()
  @MinLength(10)
  token!: string;
}
