import { ConfigService } from "@nestjs/config";

import { SpeechmaticsAdapter, SpeechmaticsSession } from "./speechmatics.adapter";

function createConfigService(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key])
  } as unknown as ConfigService;
}

describe("SpeechmaticsAdapter", () => {
  describe("without API key (stub mode)", () => {
    let adapter: SpeechmaticsAdapter;

    beforeEach(() => {
      adapter = new SpeechmaticsAdapter(createConfigService({}));
    });

    it("reports fallback mode and unconfigured STT", () => {
      expect(adapter.getMode()).toBe("fallback");
      expect(adapter.isConfigured()).toBe(false);
      expect(adapter.getLastProviderErrorAt()).toBeNull();
    });

    describe("transcribeChunk (stub)", () => {
      it("returns null for empty input", () => {
        expect(adapter.transcribeChunk("")).toBeNull();
      });

      it("returns null for very short chunks", () => {
        expect(adapter.transcribeChunk("AQID")).toBeNull();
      });

      it("returns 'listening...' for chunks of sufficient size", () => {
        const chunk = "A".repeat(48);
        expect(adapter.transcribeChunk(chunk)).toBe("listening...");
      });
    });

    describe("session management (stub)", () => {
      it("creates a stub session", async () => {
        const session = await adapter.startSession("s1");
        expect(session).toBeDefined();
        expect(session.sessionId).toBe("s1");
        expect(session.canAcceptAudio()).toBe(false);
      });

      it("returns the same session for the same id", async () => {
        const s1 = await adapter.startSession("s1");
        const s2 = await adapter.startSession("s1");
        expect(s1).toBe(s2);
      });

      it("getSession returns undefined for unknown session", () => {
        expect(adapter.getSession("unknown")).toBeUndefined();
      });

      it("endSession removes the session", async () => {
        await adapter.startSession("s1");
        await adapter.endSession("s1");
        expect(adapter.getSession("s1")).toBeUndefined();
      });
    });
  });

  describe("legacy config alias", () => {
    it("accepts ELEVENLABS_STT_API_KEY as temporary alias", () => {
      const adapter = new SpeechmaticsAdapter(
        createConfigService({
          ELEVENLABS_STT_API_KEY: "legacy-key"
        })
      );

      expect(adapter.isConfigured()).toBe(true);
      expect(adapter.getMode()).toBe("live");
    });
  });

  describe("session protocol mapping", () => {
    function createLiveSession() {
      return new SpeechmaticsSession(
        "s1",
        {
          apiKey: "test-key",
          wsUrl: "wss://example.com/v2",
          language: "en",
          enablePartials: true,
          maxDelaySeconds: 1.1
        },
        { error: jest.fn(), debug: jest.fn() } as any
      );
    }

    it("builds StartRecognition payload with raw pcm_s16le audio format", () => {
      const session = createLiveSession();
      const send = jest.fn();

      (session as any).connected = true;
      (session as any).ws = { send };
      (session as any).sendStartRecognition(16000);

      const payload = JSON.parse(send.mock.calls[0][0] as string);
      expect(payload).toMatchObject({
        message: "StartRecognition",
        audio_format: {
          type: "raw",
          encoding: "pcm_s16le",
          sample_rate: 16000
        },
        transcription_config: {
          enable_partials: true,
          max_delay: 1.1,
          language: "en"
        }
      });
      expect((session as any).recognitionStarted).toBe(true);
    });

    it("forwards decoded audio as binary websocket frames", () => {
      const session = createLiveSession();
      const send = jest.fn();

      (session as any).connected = true;
      (session as any).recognitionStarted = true;
      (session as any).ws = { send };

      session.sendAudioChunk({
        chunkBase64: "AQID",
        commit: true,
        sampleRate: 16000
      });

      expect(send).toHaveBeenCalledWith(Buffer.from([1, 2, 3]), { binary: true });
    });

    it("maps AddPartialTranscript and AddTranscript events", () => {
      const session = createLiveSession();
      const partial = jest.fn();
      const final = jest.fn();

      session.on("partial", partial);
      session.on("final", final);

      (session as any).handleMessage(
        JSON.stringify({
          message: "AddPartialTranscript",
          results: [
            { alternatives: [{ content: "hello" }] },
            { alternatives: [{ content: "world" }] }
          ]
        })
      );
      (session as any).handleMessage(
        JSON.stringify({
          message: "AddTranscript",
          results: [{ alternatives: [{ content: "confirmed" }] }]
        })
      );

      expect(partial).toHaveBeenCalledWith("hello world");
      expect(final).toHaveBeenCalledWith("confirmed");
    });

    it("parses text JSON delivered as Buffer when frame is not binary", () => {
      const session = createLiveSession();
      const partial = jest.fn();
      session.on("partial", partial);

      (session as any).handleMessage(
        Buffer.from(
          JSON.stringify({
            message: "AddPartialTranscript",
            results: [{ alternatives: [{ content: "from buffer" }] }]
          })
        ),
        false
      );

      expect(partial).toHaveBeenCalledWith("from buffer");
    });

    it("emits errors for provider Error messages", () => {
      const session = new SpeechmaticsSession(
        "s1",
        {
          apiKey: "test-key",
          wsUrl: "wss://example.com/v2",
          language: null,
          enablePartials: true,
          maxDelaySeconds: 1.1
        },
        { error: jest.fn(), debug: jest.fn() } as any,
        jest.fn()
      );

      const onError = jest.fn();
      session.on("error", onError);

      (session as any).handleMessage(
        JSON.stringify({
          message: "Error",
          reason: "quota_exceeded"
        })
      );

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect((onError.mock.calls[0][0] as Error).message).toContain("quota_exceeded");
    });

    it("sends EndOfStream payload on shutdown", () => {
      const session = createLiveSession();
      const send = jest.fn();

      const ws = { send } as any;
      (session as any).chunkCount = 4;
      (session as any).sendEndOfStream(ws);

      expect(send).toHaveBeenCalledWith(JSON.stringify({ message: "EndOfStream", last_seq_no: 4 }));
      expect((session as any).streamEnded).toBe(true);
    });
  });
});
