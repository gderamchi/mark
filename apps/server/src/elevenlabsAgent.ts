import type { EnvConfig } from "./env.js";

type ElevenLabsTool = {
  id: string;
  tool_config?: {
    name?: string;
    type?: string;
  };
};

type ElevenLabsToolCreateParams = {
  name: string;
  description: string;
  webhookUrl: string;
  secret: string;
  requestBodySchema: Record<string, unknown>;
};

export class ElevenLabsAgentService {
  private readonly baseUrl = "https://api.elevenlabs.io";

  constructor(private readonly env: EnvConfig) {}

  isConfigured(): boolean {
    return Boolean(this.env.elevenLabsApiKey && this.env.elevenLabsAgentId);
  }

  async listTools(): Promise<ElevenLabsTool[]> {
    const res = await this.request("GET", "/v1/convai/tools");
    const data = (await res.json()) as { tools?: ElevenLabsTool[] };
    return data.tools ?? [];
  }

  async createTool(params: ElevenLabsToolCreateParams): Promise<ElevenLabsTool> {
    const body = {
      tool_config: {
        type: "webhook",
        name: params.name,
        description: params.description,
        api_schema: {
          url: params.webhookUrl,
          method: "POST",
          request_headers: {
            Authorization: `Bearer ${params.secret}`,
            "Content-Type": "application/json"
          },
          request_body_schema: params.requestBodySchema
        }
      }
    };

    const res = await this.request("POST", "/v1/convai/tools", body);
    return (await res.json()) as ElevenLabsTool;
  }

  async updateTool(toolId: string, params: Partial<ElevenLabsToolCreateParams>): Promise<ElevenLabsTool> {
    const body: Record<string, unknown> = {
      tool_config: {
        type: "webhook",
        name: params.name ?? "",
        description: params.description ?? "",
        api_schema: {
          url: params.webhookUrl ?? "",
          method: "POST",
          request_headers: {
            Authorization: `Bearer ${params.secret ?? ""}`,
            "Content-Type": "application/json"
          },
          ...(params.requestBodySchema ? { request_body_schema: params.requestBodySchema } : {})
        }
      }
    };

    const res = await this.request("PATCH", `/v1/convai/tools/${toolId}`, body);
    return (await res.json()) as ElevenLabsTool;
  }

  async deleteTool(toolId: string): Promise<void> {
    await this.request("DELETE", `/v1/convai/tools/${toolId}`);
  }

  async getAgent(): Promise<Record<string, unknown>> {
    if (!this.env.elevenLabsAgentId) {
      throw new Error("ELEVENLABS_AGENT_ID is not set.");
    }
    const res = await this.request("GET", `/v1/convai/agents/${this.env.elevenLabsAgentId}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async updateAgent(fields: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.env.elevenLabsAgentId) {
      throw new Error("ELEVENLABS_AGENT_ID is not set.");
    }
    const res = await this.request("PATCH", `/v1/convai/agents/${this.env.elevenLabsAgentId}`, fields);
    return (await res.json()) as Record<string, unknown>;
  }

  async getSignedUrl(): Promise<string> {
    if (!this.env.elevenLabsAgentId) {
      throw new Error("ELEVENLABS_AGENT_ID is not set.");
    }
    const res = await this.request(
      "GET",
      `/v1/convai/conversation/get-signed-url?agent_id=${this.env.elevenLabsAgentId}`
    );
    const data = (await res.json()) as { signed_url?: string };
    if (!data.signed_url) {
      throw new Error("ElevenLabs did not return a signed URL.");
    }
    return data.signed_url;
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    if (!this.env.elevenLabsApiKey) {
      throw new Error("ELEVENLABS_API_KEY is not set.");
    }

    const headers: Record<string, string> = {
      "xi-api-key": this.env.elevenLabsApiKey
    };
    if (body) {
      headers["content-type"] = "application/json";
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`ElevenLabs API ${method} ${path} failed (${res.status}): ${text}`);
    }

    return res;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
