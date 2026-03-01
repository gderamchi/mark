import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentToolDefinition } from "./composio.js";
import type { ComposioService } from "./composio.js";
import { GmailInboxTriageService, type EmailPriorityClassifier, type TriageInputEmail } from "./gmailInboxTriage.js";

type MockMessage = {
  id: string;
  threadId: string;
  sender: string;
  subject: string;
  snippet: string;
  fullSnippet?: string;
  labelIds: string[];
};

describe("GmailInboxTriageService", () => {
  it("does not hard-lock optional for automated sender; classifier can promote to respond_needed", async () => {
    const messages: MockMessage[] = [
      {
        id: "m1",
        threadId: "t1",
        sender: "LinkedIn Jobs <jobs-listings-noreply@linkedin.com>",
        subject: "Offre d'emploi: Product Manager",
        snippet: "Souhaitez-vous candidater a cette offre ?",
        labelIds: ["UNREAD", "INBOX"]
      }
    ];

    let classifierCalls = 0;
    const classifier: EmailPriorityClassifier = {
      isConfigured: () => true,
      classify: async (emails: TriageInputEmail[]) => {
        classifierCalls += 1;
        assert.equal(emails.length, 1);
        return {
          m1: {
            category: "respond_needed",
            reason: "Professional opportunity with a concrete next step."
          }
        };
      }
    };

    const service = new GmailInboxTriageService(createMockComposio(messages), classifier);
    const result = await service.triageInbox({
      composioUserId: "user-1",
      toolsByName: createGmailTools(),
      resolvedQuery: "newer_than:2h label:inbox is:unread",
      windowLabel: "the last 2 hours",
      timeZone: "Europe/Paris"
    });

    assert.equal(classifierCalls, 1);
    assert.equal(result.respondNeeded.length, 1);
    assert.equal(result.respondNeeded[0]?.id, "m1");
    assert.equal(result.mustKnow.length, 0);
    assert.equal(result.optionalCount, 0);
    assert.equal(result.llmClassifiedCount, 1);
    assert.equal(result.heuristicClassifiedCount, 0);
    assert.equal(result.decisionAudit[0]?.source, "llm");
  });

  it("keeps strict security alerts locked as must_know", async () => {
    const messages: MockMessage[] = [
      {
        id: "m2",
        threadId: "t2",
        sender: "Google <no-reply@accounts.google.com>",
        subject: "Security alert: unauthorized login attempt",
        snippet: "Review this sign-in activity immediately.",
        labelIds: ["UNREAD", "INBOX", "CATEGORY_UPDATES"]
      }
    ];

    let classifierCalls = 0;
    const classifier: EmailPriorityClassifier = {
      isConfigured: () => true,
      classify: async () => {
        classifierCalls += 1;
        return {};
      }
    };

    const service = new GmailInboxTriageService(createMockComposio(messages), classifier);
    const result = await service.triageInbox({
      composioUserId: "user-1",
      toolsByName: createGmailTools(),
      resolvedQuery: "newer_than:1d label:inbox is:unread",
      windowLabel: "the last 24 hours",
      timeZone: "Europe/Paris"
    });

    assert.equal(classifierCalls, 0);
    assert.equal(result.mustKnow.length, 1);
    assert.equal(result.mustKnow[0]?.id, "m2");
    assert.equal(result.respondNeeded.length, 0);
    assert.equal(result.optionalCount, 0);
    assert.equal(result.llmClassifiedCount, 0);
    assert.equal(result.heuristicClassifiedCount, 1);
    assert.equal(result.decisionAudit[0]?.source, "heuristic_lock");
  });

  it("enriches empty metadata snippets from full format before classification", async () => {
    const messages: MockMessage[] = [
      {
        id: "m3",
        threadId: "t3",
        sender: "Founder <founder@startup.com>",
        subject: "Partnership opportunity",
        snippet: "",
        fullSnippet: "We are recruiting and would like to discuss a role. Let me know if you are interested.",
        labelIds: ["UNREAD", "INBOX", "CATEGORY_PERSONAL"]
      }
    ];

    let classifierCalls = 0;
    const classifier: EmailPriorityClassifier = {
      isConfigured: () => true,
      classify: async (emails: TriageInputEmail[]) => {
        classifierCalls += 1;
        assert.equal(emails.length, 1);
        assert.match(emails[0]?.snippet ?? "", /recruiting/i);
        return {
          m3: {
            category: "respond_needed",
            reason: "Direct professional outreach with explicit interest check."
          }
        };
      }
    };

    const service = new GmailInboxTriageService(createMockComposio(messages), classifier);
    const result = await service.triageInbox({
      composioUserId: "user-1",
      toolsByName: createGmailTools(),
      resolvedQuery: "newer_than:2h label:inbox is:unread",
      windowLabel: "the last 2 hours",
      timeZone: "Europe/Paris"
    });

    assert.equal(classifierCalls, 1);
    assert.equal(result.respondNeeded.length, 1);
    assert.equal(result.respondNeeded[0]?.id, "m3");
    assert.ok((result.respondNeeded[0]?.snippet.length ?? 0) > 0);
    assert.equal(result.decisionAudit[0]?.source, "llm");
  });

  it("promotes llm optional to respond_needed when direct-response cues are strong", async () => {
    const messages: MockMessage[] = [
      {
        id: "m4",
        threadId: "t4",
        sender: "Hiring Team <hello@company.com>",
        subject: "Partnership opportunity",
        snippet: "We are recruiting and think you would be a great fit. Let me know if you are interested.",
        labelIds: ["UNREAD", "INBOX", "CATEGORY_PERSONAL"]
      }
    ];

    const classifier: EmailPriorityClassifier = {
      isConfigured: () => true,
      classify: async () => ({
        m4: {
          category: "optional",
          reason: "Could be optional"
        }
      })
    };

    const service = new GmailInboxTriageService(createMockComposio(messages), classifier);
    const result = await service.triageInbox({
      composioUserId: "user-1",
      toolsByName: createGmailTools(),
      resolvedQuery: "newer_than:2h label:inbox is:unread",
      windowLabel: "the last 2 hours",
      timeZone: "Europe/Paris"
    });

    assert.equal(result.respondNeeded.length, 1);
    assert.equal(result.optionalCount, 0);
    assert.equal(result.decisionAudit[0]?.source, "llm_promoted");
  });
});

function createGmailTools(): Record<string, AgentToolDefinition> {
  return {
    GMAIL_LIST_MESSAGES: {
      toolName: "GMAIL_LIST_MESSAGES",
      toolSlug: "GMAIL_LIST_MESSAGES",
      description: "List Gmail messages",
      toolkitSlug: "gmail",
      inputSchema: { type: "object", properties: {} },
      connectedAccountId: "account-1",
      connectedAccountIds: ["account-1"],
      isMutating: false
    },
    GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: {
      toolName: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      toolSlug: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      description: "Fetch Gmail message metadata",
      toolkitSlug: "gmail",
      inputSchema: { type: "object", properties: {} },
      connectedAccountId: "account-1",
      connectedAccountIds: ["account-1"],
      isMutating: false
    }
  };
}

function createMockComposio(messages: MockMessage[]): ComposioService {
  const byId = new Map(messages.map((message) => [message.id, message]));
  return {
    executeTool: async (
      _composioUserId: string,
      tool: AgentToolDefinition,
      args: Record<string, unknown>
    ): Promise<unknown> => {
      if (tool.toolSlug === "GMAIL_LIST_MESSAGES") {
        return {
          data: {
            messages: messages.map((message) => ({
              id: message.id,
              threadId: message.threadId
            })),
            nextPageToken: null
          }
        };
      }

      if (tool.toolSlug === "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID") {
        const messageId = String(args.message_id ?? "");
        const message = byId.get(messageId);
        if (!message) {
          throw new Error("message not found");
        }
        const format = String(args.format ?? "metadata");
        const snippet = format === "full" ? message.fullSnippet ?? message.snippet : message.snippet;
        return {
          data: {
            messageId: message.id,
            threadId: message.threadId,
            sender: message.sender,
            subject: message.subject,
            snippet,
            messageText: snippet,
            labelIds: message.labelIds
          }
        };
      }

      throw new Error(`unexpected tool: ${tool.toolSlug}`);
    }
  } as unknown as ComposioService;
}
