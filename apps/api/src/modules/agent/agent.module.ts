import { Module } from "@nestjs/common";

import { ConnectorsModule } from "@/modules/connectors/connectors.module";
import { MemoryModule } from "@/modules/memory/memory.module";
import { RulesModule } from "@/modules/rules/rules.module";

import { AgentService } from "./agent.service";
import { AnthropicAdapter } from "./anthropic.adapter";

@Module({
  imports: [ConnectorsModule, MemoryModule, RulesModule],
  providers: [AgentService, AnthropicAdapter],
  exports: [AgentService]
})
export class AgentModule {}
