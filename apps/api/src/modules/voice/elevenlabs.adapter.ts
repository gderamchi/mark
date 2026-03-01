import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { isApiDebugLoggingEnabled } from "@/common/debug-logging";

export interface TtsStreamResult {
  streamId: string;
  audioChunks: Buffer[];
  contentType: string;
}

export interface TtsPreview {
  streamId: string;
  estimatedMs: number;
}

@Injectable()
export class ElevenLabsAdapter {
  private readonly logger = new Logger(ElevenLabsAdapter.name);
  private readonly debugLogsEnabled = isApiDebugLoggingEnabled();
  private readonly apiKey: string | null;
  private readonly voiceId: string;
  private readonly modelId: string;
  private readonly baseUrl = "https://api.elevenlabs.io/v1";

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>("ELEVENLABS_API_KEY") ?? null;
    this.voiceId = this.configService.get<string>("ELEVENLABS_VOICE_ID") ?? "21m00Tcm4TlvDq8ikWAM";
    this.modelId = this.configService.get<string>("ELEVENLABS_MODEL_ID") ?? "eleven_multilingual_v2";

    if (!this.apiKey) {
      this.logger.warn("ELEVENLABS_API_KEY not set — TTS will use stub responses");
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async synthesize(text: string): Promise<TtsStreamResult> {
    const streamId = `tts-${Date.now()}`;

    if (!this.apiKey) {
      return { streamId, audioChunks: [], contentType: "audio/mpeg" };
    }

    try {
      const url = `${this.baseUrl}/text-to-speech/${this.voiceId}/stream`;
      const startedAt = Date.now();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "content-type": "application/json",
          accept: "audio/mpeg"
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true
          },
          output_format: "mp3_44100_128"
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`ElevenLabs API error: ${response.status} — ${errorBody}`);
        return { streamId, audioChunks: [], contentType: "audio/mpeg" };
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get("content-type") ?? "audio/mpeg";
      this.debugTrace("tts.synthesize.success", {
        streamId,
        durationMs: Date.now() - startedAt,
        bytes: audioBuffer.length,
        contentType
      });

      return { streamId, audioChunks: [audioBuffer], contentType };
    } catch (err) {
      this.logger.error("ElevenLabs TTS error", err);
      return { streamId, audioChunks: [], contentType: "audio/mpeg" };
    }
  }

  async *synthesizeStream(text: string): AsyncGenerator<Buffer> {
    if (!this.apiKey) {
      return;
    }

    try {
      const url = `${this.baseUrl}/text-to-speech/${this.voiceId}/stream`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "content-type": "application/json",
          accept: "audio/mpeg"
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true
          },
          output_format: "mp3_44100_128"
        })
      });

      if (!response.ok || !response.body) {
        this.logger.error(`ElevenLabs stream error: ${response.status}`);
        return;
      }

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield Buffer.from(value);
      }
    } catch (err) {
      this.logger.error("ElevenLabs TTS stream error", err);
    }
  }

  synthesizeTextPreview(text: string): TtsPreview {
    return {
      streamId: `tts-${Date.now()}`,
      estimatedMs: Math.max(800, text.length * 18)
    };
  }

  private debugTrace(event: string, payload: Record<string, unknown>): void {
    if (!this.debugLogsEnabled) {
      return;
    }
    this.logger.debug(`[debug] ${event} ${JSON.stringify(payload)}`);
  }
}
