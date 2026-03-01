import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApprovalIntentService } from "./approvalIntent.js";
import { classifyToolMutability } from "./composio.js";

describe("ApprovalIntentService", () => {
  const service = new ApprovalIntentService();

  it("detects approval intent", () => {
    const result = service.detectIntent("yes send it now");
    assert.equal(result.intent, "approve");
  });

  it("detects rejection intent", () => {
    const result = service.detectIntent("don't send this, cancel");
    assert.equal(result.intent, "reject");
  });

  it("detects revision intent", () => {
    const result = service.detectIntent("change the tone and add my signature");
    assert.equal(result.intent, "revise");
  });

  it("returns ambiguous when no signal is present", () => {
    const result = service.detectIntent("hmm maybe");
    assert.equal(result.intent, "ambiguous");
  });
});

describe("classifyToolMutability", () => {
  it("classifies read tools as non mutating", () => {
    assert.equal(classifyToolMutability({ slug: "GMAIL_LIST_EMAILS", tags: [] }), false);
  });

  it("classifies send tools as mutating", () => {
    assert.equal(classifyToolMutability({ slug: "GMAIL_SEND_EMAIL", tags: [] }), true);
  });

  it("respects destructive hint tags", () => {
    assert.equal(classifyToolMutability({ slug: "UNKNOWN_TOOL", tags: ["destructiveHint"] }), true);
  });
});
