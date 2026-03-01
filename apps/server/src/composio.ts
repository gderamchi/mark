import { randomUUID } from "node:crypto";
import { Composio, type Tool } from "@composio/core";

import type { EnvConfig } from "./env.js";

export type ComposioCatalogItem = {
  authConfigId: string;
  name: string;
  toolkitSlug: string;
  toolkitName: string;
  authScheme: string | null;
  isComposioManaged: boolean;
};

export type ComposioConnection = {
  connectedAccountId: string;
  authConfigId: string | null;
  authConfigName: string | null;
  toolkitSlug: string;
  toolkitName: string;
  status: string;
};

export type AgentToolDefinition = {
  toolName: string;
  toolSlug: string;
  description: string;
  toolkitSlug: string | null;
  inputSchema: Record<string, unknown>;
  connectedAccountId: string | null;
  isMutating: boolean;
};

type ToolByName = Record<string, AgentToolDefinition>;

export class ComposioService {
  private readonly client: Composio | null;

  constructor(private readonly env: EnvConfig) {
    if (!env.composioApiKey) {
      this.client = null;
      return;
    }

    this.client = new Composio({
      apiKey: env.composioApiKey,
      baseURL: env.composioBaseUrl
    });
  }

  isConfigured(): boolean {
    return Boolean(this.client);
  }

  async listCatalog(): Promise<ComposioCatalogItem[]> {
    if (!this.client) {
      return [];
    }

    const response = await this.client.authConfigs.list();
    const items = asArray((response as { items?: unknown[] }).items);

    return items
      .map((item) => asCatalogItem(item))
      .filter((item): item is ComposioCatalogItem => item !== null)
      .sort((a, b) => a.toolkitName.localeCompare(b.toolkitName));
  }

  async createConnectLink(
    composioUserId: string,
    authConfigId: string
  ): Promise<{ redirectUrl: string; connectionRequestId: string }> {
    if (!this.client) {
      throw new Error("Composio is not configured.");
    }

    const request = await this.client.connectedAccounts.link(composioUserId, authConfigId, {
      callbackUrl: this.env.composioConnectCallbackUrl
    });

    const redirectUrl = readStringValue(request, "redirectUrl");
    if (!redirectUrl) {
      throw new Error("Composio did not return a redirect URL.");
    }

    return {
      redirectUrl,
      connectionRequestId: readStringValue(request, "id") ?? randomUUID()
    };
  }

  async waitForConnection(connectedAccountId: string): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.connectedAccounts.waitForConnection(connectedAccountId, 60_000);
  }

  async listConnections(composioUserId: string): Promise<ComposioConnection[]> {
    if (!this.client) {
      return [];
    }

    const response = await this.client.connectedAccounts.list({ userIds: [composioUserId] } as never);
    const items = asArray((response as { items?: unknown[] }).items);

    return items
      .map((item) => asConnection(item))
      .filter((item): item is ComposioConnection => item !== null)
      .sort((a, b) => a.toolkitName.localeCompare(b.toolkitName));
  }

  async listToolsByUser(composioUserId: string): Promise<ToolByName> {
    if (!this.client) {
      return {};
    }

    const connections = await this.listConnections(composioUserId);
    const activeByToolkit = new Map<string, string>();
    for (const connection of connections) {
      if (connection.status.toUpperCase() !== "ACTIVE") {
        continue;
      }
      if (!activeByToolkit.has(connection.toolkitSlug)) {
        activeByToolkit.set(connection.toolkitSlug, connection.connectedAccountId);
      }
    }

    const toolkitSlugs = Array.from(activeByToolkit.keys());
    if (toolkitSlugs.length === 0) {
      return {};
    }

    const rawTools = await this.client.tools.getRawComposioTools({
      toolkits: toolkitSlugs,
      limit: 400
    });

    const toolItems = Array.isArray(rawTools) ? rawTools : asArray((rawTools as { items?: unknown[] }).items);
    const definitions: ToolByName = {};
    for (const item of toolItems) {
      const tool = item as Tool;
      const toolName = normalizeToolName(tool.slug);
      definitions[toolName] = {
        toolName,
        toolSlug: tool.slug,
        description: tool.description ?? `${tool.name}.`,
        toolkitSlug: tool.toolkit?.slug ?? null,
        inputSchema: ensureSchema(tool.inputParameters),
        connectedAccountId: tool.toolkit?.slug ? activeByToolkit.get(tool.toolkit.slug) ?? null : null,
        isMutating: classifyToolMutability(tool)
      };
    }

    return definitions;
  }

  async executeTool(
    composioUserId: string,
    tool: AgentToolDefinition,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.client) {
      throw new Error("Composio is not configured.");
    }

    return this.client.tools.execute(tool.toolSlug, {
      userId: composioUserId,
      connectedAccountId: tool.connectedAccountId ?? undefined,
      arguments: args,
      dangerouslySkipVersionCheck: true
    });
  }
}

export function normalizeToolName(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export function classifyToolMutability(tool: Pick<Tool, "slug" | "tags">): boolean {
  const tags = (tool.tags ?? []).map((tag) => tag.toLowerCase());
  if (tags.includes("readonlyhint") || tags.includes("read_only")) {
    return false;
  }
  if (tags.includes("destructivehint")) {
    return true;
  }

  const slug = tool.slug.toLowerCase();
  if (
    /(create|update|upsert|delete|remove|send|post|write|set|append|add|modify|close|archive|invite|assign|patch)/.test(
      slug
    )
  ) {
    return true;
  }
  if (/(get|list|search|find|fetch|read|retrieve|query|view|download|preview)/.test(slug)) {
    return false;
  }
  return true;
}

function ensureSchema(inputSchema: unknown): Record<string, unknown> {
  const schema = (inputSchema ?? null) as Record<string, unknown> | null;
  if (!schema || typeof schema !== "object") {
    return {
      type: "object",
      properties: {},
      additionalProperties: true
    };
  }
  return schema;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asCatalogItem(raw: unknown): ComposioCatalogItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const item = raw as Record<string, unknown>;
  const toolkit = readObject(item, "toolkit");
  const authConfigId = readStringValue(item, "id");
  const toolkitSlug = readStringValue(toolkit, "slug");
  const toolkitName = readStringValue(toolkit, "name");
  if (!authConfigId || !toolkitSlug || !toolkitName) {
    return null;
  }

  return {
    authConfigId,
    name: readStringValue(item, "name") ?? `${toolkitName} Connection`,
    toolkitSlug,
    toolkitName,
    authScheme: readStringValue(item, "authScheme") ?? readStringValue(item, "authSchemeType"),
    isComposioManaged: readBooleanValue(item, "isComposioManaged") ?? false
  };
}

function asConnection(raw: unknown): ComposioConnection | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const item = raw as Record<string, unknown>;
  const toolkit = readObject(item, "toolkit");
  const authConfig = readObject(item, "authConfig");
  const connectedAccountId =
    readStringValue(item, "id") ?? readStringValue(item, "nanoid") ?? readStringValue(item, "connectedAccountId");
  const toolkitSlug = readStringValue(toolkit, "slug");
  const toolkitName = readStringValue(toolkit, "name");

  if (!connectedAccountId || !toolkitSlug || !toolkitName) {
    return null;
  }

  return {
    connectedAccountId,
    authConfigId: readStringValue(authConfig, "id"),
    authConfigName: readStringValue(authConfig, "name"),
    toolkitSlug,
    toolkitName,
    status: readStringValue(item, "status") ?? "UNKNOWN"
  };
}

function readObject(source: unknown, key: string): Record<string, unknown> | null {
  if (!source || typeof source !== "object") {
    return null;
  }
  const value = (source as Record<string, unknown>)[key];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readStringValue(source: unknown, key: string): string | null {
  if (!source || typeof source !== "object") {
    return null;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBooleanValue(source: unknown, key: string): boolean | null {
  if (!source || typeof source !== "object") {
    return null;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
}
