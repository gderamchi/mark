import { randomUUID } from "node:crypto";
import type { ActionDraft, ApprovalSource } from "@mark/contracts";

import { AuditService } from "./audit.js";

type PendingAction = {
  draft: ActionDraft;
  userId: string;
  sessionId: string;
  executing: boolean;
};

type ProposeParams = {
  userId: string;
  sessionId: string;
  toolSlug: string;
  toolkitSlug: string | null;
  connectedAccountId: string | null;
  summary: string;
  args: Record<string, unknown>;
  requiresApproval: boolean;
};

type ExecuteParams = {
  sessionId: string;
  actionId: string;
  revisionId: string;
  source: ApprovalSource;
  execute: (draft: ActionDraft) => Promise<unknown>;
};

type ExecuteResult =
  | { ok: true; draft: ActionDraft; result: unknown }
  | { ok: false; draft: ActionDraft | null; message: string };

export class ActionOrchestrator {
  private readonly pendingBySessionId = new Map<string, PendingAction>();

  constructor(private readonly audit: AuditService) {}

  getPending(sessionId: string): ActionDraft | null {
    return this.pendingBySessionId.get(sessionId)?.draft ?? null;
  }

  clearSession(sessionId: string): void {
    this.pendingBySessionId.delete(sessionId);
  }

  async createProposal(params: ProposeParams): Promise<ActionDraft> {
    const now = new Date().toISOString();
    const draft: ActionDraft = {
      actionId: randomUUID(),
      revisionId: randomUUID(),
      status: "pending_approval",
      toolSlug: params.toolSlug,
      toolkitSlug: params.toolkitSlug,
      connectedAccountId: params.connectedAccountId,
      summary: params.summary,
      arguments: params.args,
      requiresApproval: params.requiresApproval,
      createdAt: now,
      updatedAt: now
    };

    this.pendingBySessionId.set(params.sessionId, {
      draft,
      userId: params.userId,
      sessionId: params.sessionId,
      executing: false
    });

    await this.audit.createThread({
      actionId: draft.actionId,
      userId: params.userId,
      sessionId: params.sessionId,
      toolSlug: draft.toolSlug,
      toolkitSlug: draft.toolkitSlug,
      connectedAccountId: draft.connectedAccountId,
      status: draft.status
    });
    await this.audit.addRevision({
      actionId: draft.actionId,
      revisionId: draft.revisionId,
      userId: params.userId,
      sessionId: params.sessionId,
      summary: draft.summary,
      arguments: draft.arguments
    });
    await this.audit.logEvent({
      actionId: draft.actionId,
      userId: params.userId,
      sessionId: params.sessionId,
      eventType: "action.proposed",
      payload: {
        toolSlug: draft.toolSlug,
        summary: draft.summary,
        revisionId: draft.revisionId
      }
    });
    return draft;
  }

  async revisePending(
    sessionId: string,
    summary: string,
    args: Record<string, unknown>
  ): Promise<ActionDraft | null> {
    const pending = this.pendingBySessionId.get(sessionId);
    if (!pending) {
      return null;
    }

    const nextDraft: ActionDraft = {
      ...pending.draft,
      revisionId: randomUUID(),
      summary,
      arguments: args,
      status: "pending_approval",
      updatedAt: new Date().toISOString()
    };
    pending.draft = nextDraft;

    await this.audit.addRevision({
      actionId: nextDraft.actionId,
      revisionId: nextDraft.revisionId,
      userId: pending.userId,
      sessionId,
      summary: nextDraft.summary,
      arguments: nextDraft.arguments
    });
    await this.audit.logEvent({
      actionId: nextDraft.actionId,
      userId: pending.userId,
      sessionId,
      eventType: "action.revised",
      payload: {
        revisionId: nextDraft.revisionId,
        summary: nextDraft.summary
      }
    });
    return nextDraft;
  }

  async rejectPending(
    sessionId: string,
    source: ApprovalSource,
    reason: string
  ): Promise<ActionDraft | null> {
    const pending = this.pendingBySessionId.get(sessionId);
    if (!pending) {
      return null;
    }

    const nextDraft: ActionDraft = {
      ...pending.draft,
      status: "rejected",
      updatedAt: new Date().toISOString()
    };
    await this.audit.addDecision({
      actionId: nextDraft.actionId,
      revisionId: nextDraft.revisionId,
      userId: pending.userId,
      sessionId,
      decision: "rejected",
      source,
      reason
    });
    await this.audit.updateThreadStatus(nextDraft.actionId, "rejected");
    await this.audit.logEvent({
      actionId: nextDraft.actionId,
      userId: pending.userId,
      sessionId,
      eventType: "action.rejected",
      payload: {
        revisionId: nextDraft.revisionId,
        reason,
        source
      }
    });
    this.pendingBySessionId.delete(sessionId);
    return nextDraft;
  }

  async approveAndExecute(params: ExecuteParams): Promise<ExecuteResult> {
    const pending = this.pendingBySessionId.get(params.sessionId);
    if (!pending) {
      return { ok: false, draft: null, message: "No pending action exists." };
    }
    if (pending.executing) {
      return { ok: false, draft: pending.draft, message: "This action is already executing." };
    }
    if (pending.draft.actionId !== params.actionId || pending.draft.revisionId !== params.revisionId) {
      return { ok: false, draft: pending.draft, message: "Action revision changed. Review the latest draft." };
    }

    pending.executing = true;
    pending.draft = {
      ...pending.draft,
      status: "executing",
      updatedAt: new Date().toISOString()
    };

    await this.audit.addDecision({
      actionId: pending.draft.actionId,
      revisionId: pending.draft.revisionId,
      userId: pending.userId,
      sessionId: params.sessionId,
      decision: "approved",
      source: params.source,
      reason: null
    });
    await this.audit.updateThreadStatus(pending.draft.actionId, "executing");
    await this.audit.logEvent({
      actionId: pending.draft.actionId,
      userId: pending.userId,
      sessionId: params.sessionId,
      eventType: "action.approved",
      payload: {
        revisionId: pending.draft.revisionId,
        source: params.source
      }
    });

    try {
      const result = await params.execute(pending.draft);
      const completedDraft: ActionDraft = {
        ...pending.draft,
        status: "completed",
        updatedAt: new Date().toISOString()
      };
      await this.audit.addExecution({
        actionId: completedDraft.actionId,
        revisionId: completedDraft.revisionId,
        userId: pending.userId,
        sessionId: params.sessionId,
        toolSlug: completedDraft.toolSlug,
        outcome: "completed",
        resultPayload: toResultPayload(result)
      });
      await this.audit.updateThreadStatus(completedDraft.actionId, "completed");
      await this.audit.logEvent({
        actionId: completedDraft.actionId,
        userId: pending.userId,
        sessionId: params.sessionId,
        eventType: "action.executed",
        payload: {
          revisionId: completedDraft.revisionId,
          toolSlug: completedDraft.toolSlug
        }
      });
      this.pendingBySessionId.delete(params.sessionId);
      return { ok: true, draft: completedDraft, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown execution failure";
      const failedDraft: ActionDraft = {
        ...pending.draft,
        status: "failed",
        updatedAt: new Date().toISOString()
      };
      await this.audit.addExecution({
        actionId: failedDraft.actionId,
        revisionId: failedDraft.revisionId,
        userId: pending.userId,
        sessionId: params.sessionId,
        toolSlug: failedDraft.toolSlug,
        outcome: "failed",
        resultPayload: { message }
      });
      await this.audit.updateThreadStatus(failedDraft.actionId, "failed");
      await this.audit.logEvent({
        actionId: failedDraft.actionId,
        userId: pending.userId,
        sessionId: params.sessionId,
        eventType: "action.failed",
        payload: {
          revisionId: failedDraft.revisionId,
          message
        }
      });
      this.pendingBySessionId.delete(params.sessionId);
      return { ok: false, draft: failedDraft, message };
    }
  }
}

function toResultPayload(result: unknown): Record<string, unknown> {
  if (!result) {
    return {};
  }
  if (typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result: String(result) };
}
