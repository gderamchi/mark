import type { EnvConfig } from "./env.js";

export class ElevenLabsSttService {
  private readonly baseUrl = "https://api.elevenlabs.io/v1";
  private lastProviderErrorAt: string | null = null;

  constructor(private readonly env: EnvConfig) {}

  isConfigured(): boolean {
    return Boolean(this.env.elevenLabsApiKey);
  }

  getLastProviderErrorAt(): string | null {
    return this.lastProviderErrorAt;
  }

  async transcribeUtterance(audioBase64: string, mimeType: string): Promise<string> {
    if (!this.env.elevenLabsApiKey) {
      this.recordProviderError();
      throw new Error("ELEVENLABS_API_KEY missing");
    }

    const bytes = Buffer.from(audioBase64, "base64");
    if (bytes.length === 0) {
      throw new Error("Empty utterance payload");
    }

    const formData = new FormData();
    formData.append("file", new Blob([bytes], { type: mimeType }), pickFileName(mimeType));
    formData.append("model_id", this.env.elevenLabsSttModelId);
    if (this.env.elevenLabsSttLanguageCode) {
      formData.append("language_code", this.env.elevenLabsSttLanguageCode);
    }

    const response = await fetch(`${this.baseUrl}/speech-to-text`, {
      method: "POST",
      headers: {
        "xi-api-key": this.env.elevenLabsApiKey
      },
      body: formData
    });

    if (!response.ok) {
      this.recordProviderError();
      const details = await safeText(response);
      throw new Error(`ElevenLabs STT error ${response.status}: ${details}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const transcript = extractTranscript(payload).trim();
    if (!transcript) {
      return "";
    }
    return transcript;
  }

  private recordProviderError(): void {
    this.lastProviderErrorAt = new Date().toISOString();
  }
}

function pickFileName(mimeType: string): string {
  if (mimeType === "audio/mpeg") {
    return "utterance.mp3";
  }
  if (mimeType === "audio/wav") {
    return "utterance.wav";
  }
  return "utterance.audio";
}

function extractTranscript(payload: Record<string, unknown>): string {
  const text = payload.text;
  if (typeof text === "string") {
    return text;
  }

  const transcript = payload.transcript;
  if (typeof transcript === "string") {
    return transcript;
  }

  const words = payload.words;
  if (Array.isArray(words)) {
    const chunks = words
      .map((entry) => (entry && typeof entry === "object" && typeof (entry as { text?: unknown }).text === "string" ? (entry as { text: string }).text : ""))
      .filter((entry) => entry.length > 0);
    if (chunks.length > 0) {
      return chunks.join(" ");
    }
  }

  return "";
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
