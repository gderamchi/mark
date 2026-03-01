import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { EmailWorkflowStore } from "./emailWorkflowStore.js";
import type { TriagedEmail } from "./gmailInboxTriage.js";

function makeEmail(id: string, category: TriagedEmail["category"]): TriagedEmail {
  return {
    id,
    threadId: `thread-${id}`,
    from: "sender@example.com",
    subject: `Subject ${id}`,
    timestamp: "2026-03-01T10:00:00.000Z",
    snippet: "Please reply soon",
    labelIds: ["INBOX", "UNREAD"],
    category,
    reason: "Test"
  };
}

describe("EmailWorkflowStore", () => {
  it("persists workflow state, drafts, and sent progress", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "email-workflow-store-"));
    const storagePath = path.join(tempDir, "workflows.json");

    try {
      const store = new EmailWorkflowStore(storagePath);
      const created = store.createFromTriage({
        userId: "user-1",
        sessionId: "session-1",
        windowLabel: "the last 24 hours",
        resolvedQuery: "newer_than:1d label:inbox is:unread",
        timeZone: "Europe/Paris",
        scannedCount: 3,
        optionalCount: 1,
        capHit: false,
        respondNeededItems: [makeEmail("r1", "respond_needed"), makeEmail("r2", "respond_needed")],
        mustKnowItems: [makeEmail("m1", "must_know")]
      });

      assert.equal(created.respondNeededCount, 2);
      assert.equal(created.mustKnowCount, 1);
      assert.equal(created.sentCount, 0);
      assert.equal(created.conversation.phase, "awaiting_choice");

      const selected = store.updateConversation(created.workflowId, {
        phase: "reviewing",
        selectedCategory: "respond_needed",
        selectedIndexByCategory: {
          respond_needed: 0,
          must_know: 0
        },
        currentEmailId: "r1",
        lastDraft: null
      });
      assert.ok(selected);
      assert.equal(selected?.conversation.phase, "reviewing");
      assert.equal(selected?.conversation.currentEmailId, "r1");

      const drafted = store.recordDraft(created.workflowId, "r1", "Draft response", "Create the first draft.");
      assert.ok(drafted);
      assert.equal(drafted?.conversation.lastDraft, "Draft response");

      const sent = store.markCurrentEmailSent(created.workflowId, {
        actionId: "action-1",
        revisionId: "rev-1",
        toolSlug: "GMAIL_REPLY_TO_THREAD"
      });
      assert.ok(sent);
      assert.equal(sent?.respondNeededCount, 1);
      assert.equal(sent?.mustKnowCount, 1);
      assert.equal(sent?.sentCount, 1);

      const reloaded = new EmailWorkflowStore(storagePath);
      const latest = reloaded.getLatestByUser("user-1");
      assert.ok(latest);
      assert.equal(latest?.respondNeededCount, 1);
      assert.equal(latest?.sentCount, 1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
