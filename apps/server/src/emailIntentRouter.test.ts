import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EmailIntentRouter, normalizeTimeZone } from "./emailIntentRouter.js";

describe("EmailIntentRouter", () => {
  const router = new EmailIntentRouter();
  const fixedNow = new Date("2026-03-01T12:00:00.000Z");

  it("detects last 24 hours triage intent", () => {
    const intent = router.detect("List my emails from the last 24 hours", {
      timeZone: "Europe/Paris",
      now: fixedNow
    });
    assert.ok(intent);
    assert.equal(intent?.kind, "triage");
    if (intent?.kind === "triage") {
      assert.equal(intent.resolvedQuery, "newer_than:1d label:inbox is:unread");
    }
  });

  it("detects today in browser timezone", () => {
    const intent = router.detect("Check my inbox today", {
      timeZone: "America/New_York",
      now: fixedNow
    });
    assert.ok(intent);
    assert.equal(intent?.kind, "triage");
    if (intent?.kind === "triage") {
      assert.equal(intent.resolvedQuery, "after:2026/03/01 before:2026/03/02 label:inbox is:unread");
    }
  });

  it("detects continue intent for important emails", () => {
    const intent = router.detect("continue important emails", {
      timeZone: "UTC",
      now: fixedNow
    });
    assert.deepEqual(intent, { kind: "continue_important" });
  });

  it("does not intercept mutating email intents", () => {
    const intent = router.detect("send an email to john", {
      timeZone: "UTC",
      now: fixedNow
    });
    assert.equal(intent, null);
  });

  it("detects last hour triage intent", () => {
    const intent = router.detect("Check emails from the last hour", {
      timeZone: "Europe/Paris",
      now: fixedNow
    });
    assert.ok(intent);
    assert.equal(intent?.kind, "triage");
    if (intent?.kind === "triage") {
      assert.equal(intent.window, "relative_hours");
      assert.equal(intent.windowHours, 1);
      assert.equal(intent.resolvedQuery, "newer_than:1h label:inbox is:unread");
    }
  });

  it("detects french worded hours triage intent", () => {
    const intent = router.detect("Ramène-moi mes mails des deux dernières heures", {
      timeZone: "Europe/Paris",
      now: fixedNow
    });
    assert.ok(intent);
    assert.equal(intent?.kind, "triage");
    if (intent?.kind === "triage") {
      assert.equal(intent.window, "relative_hours");
      assert.equal(intent.windowHours, 2);
      assert.equal(intent.resolvedQuery, "newer_than:2h label:inbox is:unread");
    }
  });
});

describe("normalizeTimeZone", () => {
  it("falls back to UTC for invalid values", () => {
    assert.equal(normalizeTimeZone("Not/AZone"), "UTC");
  });
});
