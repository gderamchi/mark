import { ConfigService } from "@nestjs/config";

import { ElevenLabsAdapter } from "./elevenlabs.adapter";

describe("ElevenLabsAdapter", () => {
  describe("without API key (stub mode)", () => {
    let adapter: ElevenLabsAdapter;

    beforeEach(() => {
      const configService = {
        get: jest.fn().mockReturnValue(undefined)
      } as unknown as ConfigService;
      adapter = new ElevenLabsAdapter(configService);
    });

    it("synthesizeTextPreview returns streamId and estimated duration", () => {
      const result = adapter.synthesizeTextPreview("Hello world");

      expect(result.streamId).toMatch(/^tts-\d+$/);
      expect(result.estimatedMs).toBeGreaterThanOrEqual(800);
    });

    it("estimated duration scales with text length", () => {
      const short = adapter.synthesizeTextPreview("Hi");
      const long = adapter.synthesizeTextPreview("This is a much longer sentence that should take more time to speak.");

      expect(long.estimatedMs).toBeGreaterThan(short.estimatedMs);
    });

    it("synthesize returns empty audio chunks without API key", async () => {
      const result = await adapter.synthesize("Hello world");

      expect(result.streamId).toMatch(/^tts-/);
      expect(result.audioChunks).toEqual([]);
      expect(result.contentType).toBe("audio/mpeg");
    });

    it("synthesizeStream yields nothing without API key", async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of adapter.synthesizeStream("Hello")) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([]);
    });
  });
});
