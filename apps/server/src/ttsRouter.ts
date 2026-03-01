import type { TtsProvider } from "@mark/contracts";

import { ElevenLabsService } from "./elevenlabs.js";
import { SpeechmaticsTtsService } from "./speechmaticsTts.js";

type TtsChunk = {
  chunk: Buffer;
  streamId: string;
  provider: TtsProvider;
  contentType: "audio/mpeg" | "audio/wav";
};

export type TtsSynthesisResult = {
  streamId: string;
  provider: TtsProvider;
  contentType: "audio/mpeg" | "audio/wav";
};

export class TtsRouter {
  constructor(
    private readonly speechmaticsTts: SpeechmaticsTtsService,
    private readonly elevenLabsTts: ElevenLabsService
  ) {}

  isAnyConfigured(): boolean {
    return this.speechmaticsTts.isConfigured() || this.elevenLabsTts.isConfigured();
  }

  getLastProviderErrorAt(): string | null {
    const timestamps = [this.speechmaticsTts.getLastProviderErrorAt(), this.elevenLabsTts.getLastProviderErrorAt()]
      .filter((value): value is string => typeof value === "string")
      .sort();

    if (timestamps.length === 0) {
      return null;
    }
    return timestamps[timestamps.length - 1] ?? null;
  }

  async synthesizeWithPriority(
    text: string,
    onChunk: (payload: TtsChunk) => void,
    signal?: AbortSignal
  ): Promise<TtsSynthesisResult> {
    try {
      const speechmaticsResult = await this.speechmaticsTts.synthesizeStream(
        text,
        (chunk, streamId) => {
          onChunk({
            chunk,
            streamId,
            provider: "speechmatics",
            contentType: "audio/wav"
          });
        },
        signal
      );

      return {
        streamId: speechmaticsResult.streamId,
        provider: "speechmatics",
        contentType: speechmaticsResult.contentType
      };
    } catch (err) {
      if (isAbortError(err)) {
        throw err;
      }
      // Fall through to ElevenLabs fallback
    }

    const streamId = await this.elevenLabsTts.synthesizeStream(
      text,
      (chunk, id) => {
        onChunk({
          chunk,
          streamId: id,
          provider: "elevenlabs",
          contentType: "audio/mpeg"
        });
      },
      signal
    );

    return {
      streamId,
      provider: "elevenlabs",
      contentType: "audio/mpeg"
    };
  }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === "AbortError";
  }
  if (!err || typeof err !== "object") {
    return false;
  }
  const candidate = err as { name?: unknown; code?: unknown };
  return candidate.name === "AbortError" || candidate.code === "ABORT_ERR";
}
