import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter } from "node:events";
import WebSocket from "ws";

import { isApiDebugLoggingEnabled, parseBooleanFlag } from "@/common/debug-logging";

export interface SpeechmaticsEvents {
  partial: (text: string) => void;
  final: (text: string) => void;
  error: (err: Error) => void;
  close: () => void;
}

export interface AudioChunkInput {
  chunkBase64: string;
  commit?: boolean;
  sampleRate?: number;
}

interface SpeechmaticsTokenAlternative {
  content?: string;
}

interface SpeechmaticsToken {
  type?: string;
  alternatives?: SpeechmaticsTokenAlternative[];
}

interface SpeechmaticsRealtimeMessage {
  message?: string;
  reason?: string;
  metadata?: {
    transcript?: string;
  };
  results?: SpeechmaticsToken[];
  [key: string]: unknown;
}

interface SpeechmaticsSessionConfig {
  apiKey: string | null;
  wsUrl: string;
  language: string | null;
  enablePartials: boolean;
  maxDelaySeconds: number;
}

const DEFAULT_AUDIO_SAMPLE_RATE = 16000;
const DEFAULT_WS_URL = "wss://eu2.rt.speechmatics.com/v2";

@Injectable()
export class SpeechmaticsAdapter {
  private readonly logger = new Logger(SpeechmaticsAdapter.name);
  private readonly debugLogsEnabled = isApiDebugLoggingEnabled();
  private readonly sessionConfig: SpeechmaticsSessionConfig;
  private readonly mode: "live" | "fallback";
  private readonly sessions = new Map<string, SpeechmaticsSession>();
  private lastProviderErrorAt: string | null = null;

  constructor(private readonly configService: ConfigService) {
    this.warnOnLegacyConfigUsage();

    this.sessionConfig = {
      apiKey:
        this.readConfig("SPEECHMATICS_API_KEY") ??
        this.readConfig("ELEVENLABS_STT_API_KEY") ??
        this.readConfig("ELEVENLABS_API_KEY") ??
        null,
      wsUrl: this.readConfig("SPEECHMATICS_RT_URL") ?? this.readConfig("ELEVENLABS_STT_WS_URL") ?? DEFAULT_WS_URL,
      language: this.readConfig("SPEECHMATICS_LANGUAGE") ?? this.readConfig("ELEVENLABS_STT_LANGUAGE_CODE") ?? "en",
      enablePartials: this.readBooleanConfig("SPEECHMATICS_ENABLE_PARTIALS", true),
      maxDelaySeconds: this.readNumberConfig("SPEECHMATICS_MAX_DELAY_SECONDS", 1.1)
    };

    this.mode = this.sessionConfig.apiKey ? "live" : "fallback";
    this.logger.log(`voiceMode=${this.mode}`);
    this.debugTrace("stt.adapter.config", {
      mode: this.mode,
      wsUrl: this.sessionConfig.wsUrl,
      language: this.sessionConfig.language,
      enablePartials: this.sessionConfig.enablePartials,
      maxDelaySeconds: this.sessionConfig.maxDelaySeconds
    });

    if (!this.sessionConfig.apiKey) {
      this.logger.warn("SPEECHMATICS_API_KEY not set — STT will use stub responses");
    }
  }

  async startSession(sessionId: string): Promise<SpeechmaticsSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const session = new SpeechmaticsSession(
      sessionId,
      this.sessionConfig,
      this.logger,
      this.recordProviderError.bind(this),
      this.debugLogsEnabled
    );
    this.sessions.set(sessionId, session);

    session.on("close", () => {
      this.sessions.delete(sessionId);
    });

    if (this.sessionConfig.apiKey) {
      try {
        await session.connect();
        this.debugTrace("stt.session.connected", {
          sessionId
        });
      } catch (err) {
        this.recordProviderError();
        this.logger.error(`Failed to connect Speechmatics STT session [${sessionId}]`, err);
      }
    }

    return session;
  }

  getSession(sessionId: string): SpeechmaticsSession | undefined {
    return this.sessions.get(sessionId);
  }

  async endSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.close();
      this.sessions.delete(sessionId);
    }
  }

  isConfigured(): boolean {
    return Boolean(this.sessionConfig.apiKey);
  }

  getMode(): "live" | "fallback" {
    return this.mode;
  }

  getLastProviderErrorAt(): string | null {
    return this.lastProviderErrorAt;
  }

  /** @deprecated Stub fallback for when no API key is configured */
  transcribeChunk(chunkBase64: string): string | null {
    if (!chunkBase64) {
      return null;
    }

    const sizeHint = Math.floor(chunkBase64.length / 8);
    if (sizeHint < 6) {
      return null;
    }

    return "listening...";
  }

  private readConfig(key: string): string | null {
    const value = this.configService.get<string>(key);
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readBooleanConfig(key: string, defaultValue: boolean): boolean {
    const raw = this.readConfig(key);
    if (raw === null) {
      return defaultValue;
    }
    return parseBooleanFlag(raw);
  }

  private readNumberConfig(key: string, defaultValue: number): number {
    const raw = this.readConfig(key);
    if (raw === null) {
      return defaultValue;
    }

    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return defaultValue;
    }
    return value;
  }

  private warnOnLegacyConfigUsage(): void {
    const legacyVars = [
      "ELEVENLABS_STT_API_KEY",
      "ELEVENLABS_STT_WS_URL",
      "ELEVENLABS_STT_LANGUAGE_CODE",
      "ELEVENLABS_STT_MODEL_ID",
      "ELEVENLABS_STT_INCLUDE_TIMESTAMPS",
      "ELEVENLABS_STT_COMMIT_STRATEGY",
      "ELEVENLABS_STT_VAD_SILENCE_THRESHOLD_SECS"
    ];

    for (const legacyVar of legacyVars) {
      if (this.configService.get<string>(legacyVar)) {
        this.logger.warn(`${legacyVar} is deprecated. Please migrate to SPEECHMATICS_* settings.`);
      }
    }
  }

  private recordProviderError(): void {
    this.lastProviderErrorAt = new Date().toISOString();
    this.debugTrace("stt.provider.error_recorded", {
      at: this.lastProviderErrorAt
    });
  }

  private debugTrace(event: string, payload: Record<string, unknown>): void {
    if (!this.debugLogsEnabled) {
      return;
    }
    this.logger.debug(`[debug] ${event} ${JSON.stringify(payload)}`);
  }
}

export class SpeechmaticsSession extends EventEmitter {
  private ws: WebSocket | null = null;
  private connected = false;
  private recognitionStarted = false;
  private streamEnded = false;
  private chunkCount = 0;

  constructor(
    public readonly sessionId: string,
    private readonly config: SpeechmaticsSessionConfig,
    private readonly logger: Logger,
    private readonly onProviderError?: () => void,
    private readonly debugLogsEnabled = false
  ) {
    super();
  }

  async connect(): Promise<void> {
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      return;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      this.ws = new WebSocket(this.config.wsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      });
      this.debugTrace("stt.ws.connecting", {
        sessionId: this.sessionId,
        url: this.config.wsUrl
      });

      this.ws.on("open", () => {
        this.connected = true;
        this.streamEnded = false;
        this.debugTrace("stt.ws.open", { sessionId: this.sessionId });
        this.sendStartRecognition(DEFAULT_AUDIO_SAMPLE_RATE);

        if (!settled) {
          settled = true;
          resolve();
        }
      });

      this.ws.on("message", (data: WebSocket.Data, isBinary: boolean) => {
        this.handleMessage(data, isBinary);
      });

      this.ws.on("error", (err: Error) => {
        this.logger.error(`Speechmatics STT WS error [${this.sessionId}]`, err.message);
        this.onProviderError?.();
        this.emit("error", err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.recognitionStarted = false;
        this.streamEnded = true;
        this.emit("close");
      });
    });
  }

  sendAudioChunk(input: AudioChunkInput): void {
    if (!this.ws || !this.connected || !this.recognitionStarted) {
      return;
    }

    const { chunkBase64, commit, sampleRate } = input;
    if (!chunkBase64) {
      return;
    }

    const audioBuffer = Buffer.from(chunkBase64, "base64");
    if (audioBuffer.length === 0) {
      return;
    }

    this.chunkCount += 1;
    if (commit || this.chunkCount % 20 === 0) {
      this.debugTrace("stt.ws.audio_chunk.sent", {
        sessionId: this.sessionId,
        chunkCount: this.chunkCount,
        bytes: audioBuffer.length,
        commit: commit ?? false,
        sampleRate: sampleRate ?? DEFAULT_AUDIO_SAMPLE_RATE
      });
    }

    this.ws.send(audioBuffer, { binary: true });
  }

  canAcceptAudio(): boolean {
    return Boolean(this.config.apiKey) && this.connected && this.recognitionStarted;
  }

  async close(): Promise<void> {
    if (!this.ws) {
      return;
    }

    const ws = this.ws;
    this.ws = null;

    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      return;
    }

    if (this.connected && !this.streamEnded) {
      try {
        this.sendEndOfStream(ws);
      } catch {
        // no-op
      }
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          ws.terminate();
        } catch {
          // no-op
        }
        resolve();
      }, 3000);

      ws.once("close", () => {
        clearTimeout(timeout);
        this.debugTrace("stt.ws.closed", { sessionId: this.sessionId });
        resolve();
      });

      try {
        ws.close(1000);
      } catch {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  private sendStartRecognition(sampleRate: number): void {
    if (!this.ws || !this.connected || this.recognitionStarted) {
      return;
    }

    const payload: Record<string, unknown> = {
      message: "StartRecognition",
      audio_format: {
        type: "raw",
        encoding: "pcm_s16le",
        sample_rate: sampleRate
      },
      transcription_config: {
        enable_partials: this.config.enablePartials,
        max_delay: this.config.maxDelaySeconds,
        ...(this.config.language ? { language: this.config.language } : {})
      }
    };

    this.ws.send(JSON.stringify(payload));
    this.recognitionStarted = true;
    this.debugTrace("stt.ws.start_recognition", {
      sessionId: this.sessionId,
      sampleRate,
      language: this.config.language
    });
  }

  private sendEndOfStream(ws: WebSocket): void {
    ws.send(
      JSON.stringify({
        message: "EndOfStream",
        last_seq_no: Math.max(0, this.chunkCount)
      })
    );
    this.streamEnded = true;
    this.debugTrace("stt.ws.end_of_stream", { sessionId: this.sessionId });
  }

  private handleMessage(data: WebSocket.Data, isBinary = false): void {
    if (isBinary) {
      this.debugTrace("stt.ws.binary_message", {
        sessionId: this.sessionId,
        size: Buffer.isBuffer(data) ? data.length : data.toString().length
      });
      return;
    }

    const serialized = Buffer.isBuffer(data) ? data.toString("utf8") : data.toString();
    if (!serialized) {
      return;
    }

    try {
      const msg = JSON.parse(serialized) as SpeechmaticsRealtimeMessage;
      const messageType = typeof msg.message === "string" ? msg.message : "";

      if (messageType === "RecognitionStarted") {
        this.debugTrace("stt.ws.message", {
          sessionId: this.sessionId,
          type: messageType
        });
        return;
      }

      if (messageType === "AddPartialTranscript") {
        const text = this.extractTranscriptText(msg);
        if (text) {
          this.emit("partial", text);
        }
        return;
      }

      if (messageType === "AddTranscript") {
        const text = this.extractTranscriptText(msg);
        if (text) {
          this.emit("final", text);
        }
        return;
      }

      if (messageType === "Error") {
        const reason = typeof msg.reason === "string" ? msg.reason : JSON.stringify(msg);
        this.logger.error(`Speechmatics STT error [${this.sessionId}]: ${reason}`);
        this.onProviderError?.();
        this.emit("error", new Error(`Speechmatics STT error: ${reason}`));
        return;
      }

      this.debugTrace("stt.ws.message", {
        sessionId: this.sessionId,
        type: messageType || "unknown"
      });
    } catch (err) {
      this.logger.error(`Failed to parse Speechmatics STT message [${this.sessionId}]`, err);
    }
  }

  private extractTranscriptText(msg: SpeechmaticsRealtimeMessage): string {
    if (Array.isArray(msg.results)) {
      const text = msg.results
        .map((token) => token?.alternatives?.[0]?.content ?? "")
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" ")
        .replace(/\s+([,.;!?])/g, "$1")
        .trim();

      if (text) {
        return text;
      }
    }

    const metadataTranscript = msg.metadata?.transcript;
    if (typeof metadataTranscript === "string") {
      return metadataTranscript.trim();
    }

    return "";
  }

  private debugTrace(event: string, payload: Record<string, unknown>): void {
    if (!this.debugLogsEnabled) {
      return;
    }
    this.logger.debug(`[debug] ${event} ${JSON.stringify(payload)}`);
  }
}
