import type { ImportanceRules, MessageDigest } from "@mark/contracts";

import { ImportanceScoringService } from "./importance-scoring.service";

const baseRules: ImportanceRules = {
  vipSenders: ["ceo@important-client.com"],
  vipDomains: ["important-client.com"],
  keywords: ["urgent", "deadline"],
  mutedDomains: ["producthunt.com"]
};

const baseMessage: MessageDigest = {
  id: "m1",
  connectorId: "gmail",
  from: "ceo@important-client.com",
  fromDomain: "important-client.com",
  subject: "Urgent deadline",
  snippet: "Need your answer today",
  receivedAt: new Date().toISOString()
};

describe("ImportanceScoringService", () => {
  const service = new ImportanceScoringService();

  it("marks VIP urgent message as important", () => {
    const result = service.score(baseMessage, baseRules);

    expect(result.category).toBe("important");
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it("downgrades muted newsletter as bulk", () => {
    const result = service.score(
      {
        ...baseMessage,
        id: "m2",
        from: "newsletter@producthunt.com",
        fromDomain: "producthunt.com",
        subject: "Weekly newsletter",
        snippet: "Unsubscribe for promo discounts"
      },
      baseRules
    );

    expect(result.category).toBe("bulk");
    expect(result.score).toBeLessThanOrEqual(0.25);
  });
});
