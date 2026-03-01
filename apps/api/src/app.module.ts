import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";

import { JwtAuthGuard } from "./common/jwt-auth.guard";
import { AgentModule } from "./modules/agent/agent.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ConnectorsModule } from "./modules/connectors/connectors.module";
import { HealthModule } from "./modules/health/health.module";
import { MemoryModule } from "./modules/memory/memory.module";
import { PolicyModule } from "./modules/policy/policy.module";
import { RulesModule } from "./modules/rules/rules.module";
import { TimelineModule } from "./modules/timeline/timeline.module";
import { VoiceModule } from "./modules/voice/voice.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    AuthModule,
    ConnectorsModule,
    RulesModule,
    MemoryModule,
    AuditModule,
    TimelineModule,
    PolicyModule,
    AgentModule,
    VoiceModule
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard
    }
  ]
})
export class AppModule {}
