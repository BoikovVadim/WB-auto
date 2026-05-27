import { IsString, Matches, MinLength } from "class-validator";

export class SetWbTokenDto {
  @IsString()
  @MinLength(10)
  // WB tokens are JWT-style strings (base64url segments) with no whitespace or
  // control characters. Rejecting anything else also prevents newline injection
  // when the value is later persisted to the .env file.
  @Matches(/^[\x21-\x7e]+$/, {
    message: "token must not contain whitespace or control characters",
  })
  token!: string;
}
