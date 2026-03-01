import { Body, Controller, Get, Put } from "@nestjs/common";

import { CurrentUserId } from "@/common/current-user-id.decorator";

import { UpdateImportanceRulesDto } from "./rules.dto";
import { RulesService } from "./rules.service";

@Controller("v1/rules")
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @Get("importance")
  getImportanceRules(@CurrentUserId() userId: string) {
    return {
      rules: this.rulesService.getImportanceRules(userId)
    };
  }

  @Put("importance")
  updateImportanceRules(@CurrentUserId() userId: string, @Body() body: UpdateImportanceRulesDto) {
    return {
      rules: this.rulesService.updateImportanceRules(userId, body)
    };
  }
}
