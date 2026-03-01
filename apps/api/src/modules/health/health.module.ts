import { Module } from "@nestjs/common";

import { VoiceModule } from "@/modules/voice/voice.module";

import { HealthController } from "./health.controller";

@Module({
  imports: [VoiceModule],
  controllers: [HealthController]
})
export class HealthModule {}
