import { IsIn } from "class-validator";

const MODES = ["off", "preview", "live"] as const;

export class SetAutomationModeDto {
  @IsIn(MODES)
  mode!: (typeof MODES)[number];
}
