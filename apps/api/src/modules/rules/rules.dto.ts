import { IsArray, IsOptional, IsString } from "class-validator";

export class UpdateImportanceRulesDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vipSenders?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vipDomains?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mutedDomains?: string[];
}
