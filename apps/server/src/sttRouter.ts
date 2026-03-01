import { ElevenLabsSttService } from "./elevenlabsStt.js";
import { SpeechmaticsAdapter } from "./speechmatics.js";

export class SttRouter {
  constructor(
    private readonly elevenLabsStt: ElevenLabsSttService,
    private readonly speechmaticsStt: SpeechmaticsAdapter
  ) {}

  isAnyConfigured(): boolean {
    return this.elevenLabsStt.isConfigured() || this.speechmaticsStt.isConfigured();
  }

  getLastProviderErrorAt(): string | null {
    const timestamps = [this.elevenLabsStt.getLastProviderErrorAt(), this.speechmaticsStt.getLastProviderErrorAt()]
      .filter((value): value is string => typeof value === "string")
      .sort();

    if (timestamps.length === 0) {
      return null;
    }
    return timestamps[timestamps.length - 1] ?? null;
  }

  async transcribeWithPriority(audioBase64: string, mimeType: string): Promise<string> {
    try {
      return await this.elevenLabsStt.transcribeUtterance(audioBase64, mimeType);
    } catch {
      // Fall through to Speechmatics fallback.
    }
    return this.speechmaticsStt.transcribeUtterance(audioBase64, mimeType);
  }
}
