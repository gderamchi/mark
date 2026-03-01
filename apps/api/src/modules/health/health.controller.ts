import { Controller, Get } from "@nestjs/common";

import { Public } from "@/common/public.decorator";
import { ElevenLabsAdapter } from "@/modules/voice/elevenlabs.adapter";
import { SpeechmaticsAdapter } from "@/modules/voice/speechmatics.adapter";

@Controller("health")
export class HealthController {
  constructor(
    private readonly speechmaticsAdapter: SpeechmaticsAdapter,
    private readonly elevenLabsAdapter: ElevenLabsAdapter
  ) {}

  @Public()
  @Get()
  getHealth() {
    return {
      status: "ok",
      now: new Date().toISOString()
    };
  }

  @Public()
  @Get("voice")
  getVoiceHealth() {
    return {
      sttConfigured: this.speechmaticsAdapter.isConfigured(),
      ttsConfigured: this.elevenLabsAdapter.isConfigured(),
      lastSttErrorAt: this.speechmaticsAdapter.getLastProviderErrorAt(),
      mode: this.speechmaticsAdapter.getMode()
    };
  }
}
