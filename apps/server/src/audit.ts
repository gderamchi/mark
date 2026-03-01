import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { ActionHistoryItem } from "@mark/contracts";

import type { EnvConfig } from "./env.js";

type LogEventParams = {
  userId: string;
  sessionId: string;
  actionId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
};

type RevisionParams = {
  actionId: string;
  revisionId: string;
  userId: string;
  sessionId: string;
  summary: string;
  arguments: Record<string, unknown>;
};

type DecisionParams = {
  actionId: string;
  revisionId: string;
  userId: string;
  sessionId: string;
  decision: "approved" | "rejected";
  source: "voice" | "ui";
  reason: string | null;
};

type ExecutionParams = {
  actionId: string;
  revisionId: string;
  userId: string;
  sessionId: string;
  toolSlug: string;
  outcome: "completed" | "failed";
  resultPayload: Record<string, unknown>;
};

export class AuditService {
  private readonly serviceClient;
  private readonly memoryEvents: ActionHistoryItem[] = [];
  private warned = false;

  constructor(env: EnvConfig) {
    if (env.supabaseUrl && env.supabaseServiceRoleKey) {
      this.serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
    } else {
      this.serviceClient = null;
    }
  }

  isConfigured(): boolean {
    return Boolean(this.serviceClient);
  }

  async createThread(params: {
    actionId: string;
    userId: string;
    sessionId: string;
    toolSlug: string;
    toolkitSlug: string | null;
    connectedAccountId: string | null;
    status: string;
  }): Promise<void> {
    if (!this.serviceClient) {
      return;
    }
    await this.safeUpsert("agent_action_threads", {
      id: params.actionId,
      user_id: params.userId,
      session_id: params.sessionId,
      tool_slug: params.toolSlug,
      toolkit_slug: params.toolkitSlug,
      connected_account_id: params.connectedAccountId,
      status: params.status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

  async updateThreadStatus(actionId: string, status: string): Promise<void> {
    if (!this.serviceClient) {
      return;
    }
    await this.safeUpdate("agent_action_threads", actionId, {
      status,
      updated_at: new Date().toISOString()
    });
  }

  async addRevision(params: RevisionParams): Promise<void> {
    await this.safeInsert("agent_action_revisions", {
      id: params.revisionId,
      action_id: params.actionId,
      user_id: params.userId,
      session_id: params.sessionId,
      summary: params.summary,
      arguments: params.arguments,
      created_at: new Date().toISOString()
    });
  }

  async addDecision(params: DecisionParams): Promise<void> {
    await this.safeInsert("agent_action_decisions", {
      id: randomUUID(),
      action_id: params.actionId,
      revision_id: params.revisionId,
      user_id: params.userId,
      session_id: params.sessionId,
      decision: params.decision,
      source: params.source,
      reason: params.reason,
      created_at: new Date().toISOString()
    });
  }

  async addExecution(params: ExecutionParams): Promise<void> {
    await this.safeInsert("agent_action_executions", {
      id: randomUUID(),
      action_id: params.actionId,
      revision_id: params.revisionId,
      user_id: params.userId,
      session_id: params.sessionId,
      tool_slug: params.toolSlug,
      outcome: params.outcome,
      result_payload: params.resultPayload,
      created_at: new Date().toISOString()
    });
  }

  async logEvent(params: LogEventParams): Promise<void> {
    const event: ActionHistoryItem = {
      id: randomUUID(),
      actionId: params.actionId ?? null,
      sessionId: params.sessionId,
      eventType: params.eventType,
      payload: params.payload,
      createdAt: new Date().toISOString()
    };

    this.memoryEvents.unshift(event);
    if (this.memoryEvents.length > 500) {
      this.memoryEvents.length = 500;
    }

    await this.safeInsert("agent_event_log", {
      id: event.id,
      action_id: event.actionId,
      user_id: params.userId,
      session_id: params.sessionId,
      event_type: event.eventType,
      payload: event.payload,
      created_at: event.createdAt
    });
  }

  async listHistory(userId: string, limit = 80): Promise<ActionHistoryItem[]> {
    if (!this.serviceClient) {
      return this.memoryEvents.slice(0, limit);
    }

    const { data, error } = await this.serviceClient
      .from("agent_event_log")
      .select("id, action_id, session_id, event_type, payload, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data) {
      this.warnOnce(error?.message ?? "Failed to read audit history.");
      return this.memoryEvents.slice(0, limit);
    }

    return data.map((row) => ({
      id: String(row.id),
      actionId: typeof row.action_id === "string" ? row.action_id : null,
      sessionId: String(row.session_id),
      eventType: String(row.event_type),
      payload: isObject(row.payload) ? (row.payload as Record<string, unknown>) : {},
      createdAt: String(row.created_at)
    }));
  }

  private async safeInsert(table: string, row: Record<string, unknown>): Promise<void> {
    if (!this.serviceClient) {
      return;
    }

    const { error } = await this.serviceClient.from(table).insert(row);
    if (error) {
      this.warnOnce(error.message);
    }
  }

  private async safeUpsert(table: string, row: Record<string, unknown>): Promise<void> {
    if (!this.serviceClient) {
      return;
    }

    const { error } = await this.serviceClient.from(table).upsert(row);
    if (error) {
      this.warnOnce(error.message);
    }
  }

  private async safeUpdate(table: string, id: string, fields: Record<string, unknown>): Promise<void> {
    if (!this.serviceClient) {
      return;
    }

    const { error } = await this.serviceClient.from(table).update(fields).eq("id", id);
    if (error) {
      this.warnOnce(error.message);
    }
  }

  private warnOnce(message: string): void {
    if (this.warned) {
      return;
    }
    this.warned = true;
    console.warn(`audit warning: ${message}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
