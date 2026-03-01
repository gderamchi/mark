import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface ComposioConnection {
  connectorId: string;
  entityId: string;
  status: "active" | "pending" | "expired";
}

interface ComposioActionResult {
  status: string;
  data: Record<string, unknown>;
}

/**
 * Composio SDK adapter — wraps the Composio API for OAuth connection
 * management and action execution on third-party platforms.
 *
 * When COMPOSIO_API_KEY is not set, all methods return stub responses
 * so the app can still run in development without a Composio account.
 */
@Injectable()
export class ComposioAdapter {
  private readonly logger = new Logger(ComposioAdapter.name);
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>("COMPOSIO_API_KEY") ?? null;
    this.baseUrl = this.configService.get<string>("COMPOSIO_BASE_URL") ?? "https://backend.composio.dev/api/v1";

    if (!this.apiKey) {
      this.logger.warn("COMPOSIO_API_KEY not set — connectors will use stub responses");
    }
  }

  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  async initiateConnection(entityId: string, appName: string): Promise<{ redirectUrl: string; connectionId: string }> {
    if (!this.apiKey) {
      return {
        redirectUrl: `https://auth.example.local/${appName}/oauth`,
        connectionId: `stub-${Date.now()}`
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/connectedAccounts`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          integrationId: appName,
          entityId
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Composio initiateConnection error: ${response.status} — ${errorBody}`);
        throw new Error(`Composio connection failed: ${response.status}`);
      }

      const data = (await response.json()) as { redirectUrl: string; id: string };
      return { redirectUrl: data.redirectUrl, connectionId: data.id };
    } catch (err) {
      this.logger.error("Composio initiateConnection error", err);
      throw err;
    }
  }

  async getConnection(entityId: string, appName: string): Promise<ComposioConnection | null> {
    if (!this.apiKey) {
      return null;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/connectedAccounts?entityId=${encodeURIComponent(entityId)}&integrationId=${encodeURIComponent(appName)}&status=ACTIVE`,
        {
          headers: { "x-api-key": this.apiKey }
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as { items: Array<{ id: string; status: string }> };
      const active = data.items?.[0];
      if (!active) return null;

      return {
        connectorId: appName,
        entityId,
        status: "active"
      };
    } catch (err) {
      this.logger.error("Composio getConnection error", err);
      return null;
    }
  }

  async executeAction(
    entityId: string,
    actionName: string,
    params: Record<string, unknown>
  ): Promise<ComposioActionResult> {
    if (!this.apiKey) {
      return { status: "ok", data: { stub: true } };
    }

    try {
      const response = await fetch(`${this.baseUrl}/actions/${encodeURIComponent(actionName)}/execute`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          entityId,
          input: params
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Composio executeAction error: ${response.status} — ${errorBody}`);
        return { status: "error", data: { error: errorBody } };
      }

      const result = (await response.json()) as Record<string, unknown>;
      return { status: "ok", data: result };
    } catch (err) {
      this.logger.error("Composio executeAction error", err);
      return { status: "error", data: { error: String(err) } };
    }
  }

  async getAvailableTools(appName: string): Promise<string[]> {
    if (!this.apiKey) {
      return [];
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/actions?appNames=${encodeURIComponent(appName)}`,
        {
          headers: { "x-api-key": this.apiKey }
        }
      );

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as { items: Array<{ name: string }> };
      return data.items?.map(item => item.name) ?? [];
    } catch (err) {
      this.logger.error("Composio getAvailableTools error", err);
      return [];
    }
  }
}
