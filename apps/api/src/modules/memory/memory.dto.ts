import { IsBoolean } from "class-validator";

export class MemoryOptOutDto {
  @IsBoolean()
  enabled!: boolean;
}
