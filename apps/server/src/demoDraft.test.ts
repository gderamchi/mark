import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDemoFictionalReplyDraft } from "./demoDraft.js";

describe("buildDemoFictionalReplyDraft", () => {
  it("creates deterministic demo text with invented numbers", () => {
    const email = {
      id: "email-1",
      from: "Jordan Lee <jordan@client.com>",
      subject: "Q2 growth partnership",
      snippet: "Can you share a performance update before we align on next steps?"
    };

    const first = buildDemoFictionalReplyDraft({
      email,
      instruction: "Create the first draft."
    });
    const second = buildDemoFictionalReplyDraft({
      email,
      instruction: "Create the first draft."
    });

    assert.equal(first, second);
    assert.match(first, /\+\d+%/);
    assert.match(first, /\$\d{1,3}(,\d{3})*/);
    assert.match(first, /\bHi Jordan\b/);
  });

  it("changes figures when the seed changes", () => {
    const base = buildDemoFictionalReplyDraft({
      email: {
        id: "email-a",
        from: "Alex <alex@client.com>",
        subject: "Partnership",
        snippet: "Let me know your availability."
      },
      instruction: "Create the first draft."
    });

    const variant = buildDemoFictionalReplyDraft({
      email: {
        id: "email-b",
        from: "Alex <alex@client.com>",
        subject: "Partnership",
        snippet: "Let me know your availability."
      },
      instruction: "Create the first draft."
    });

    assert.notEqual(base, variant);
  });
});
