import { Module } from "@nestjs/common";

import { AgentModule } from "@/modules/agent/agent.module";
import { AuditModule } from "@/modules/audit/audit.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { ConnectorsModule } from "@/modules/connectors/connectors.module";
import { PolicyModule } from "@/modules/policy/policy.module";
import { TimelineModule } from "@/modules/timeline/timeline.module";

import { ElevenLabsAdapter } from "./elevenlabs.adapter";
import { SpeechmaticsAdapter } from "./speechmatics.adapter";
import { VoiceGateway } from "./voice.gateway";

@Module({
  imports: [AgentModule, TimelineModule, PolicyModule, ConnectorsModule, AuditModule, AuthModule],
  providers: [SpeechmaticsAdapter, ElevenLabsAdapter, VoiceGateway],
  exports: [SpeechmaticsAdapter, ElevenLabsAdapter]
})
export class VoiceModule {}
