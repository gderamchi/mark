import { Module } from "@nestjs/common";

import { RulesController } from "./rules.controller";
import { ImportanceScoringService } from "./importance-scoring.service";
import { RulesService } from "./rules.service";

@Module({
  controllers: [RulesController],
  providers: [RulesService, ImportanceScoringService],
  exports: [RulesService, ImportanceScoringService]
})
export class RulesModule {}
