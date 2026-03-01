import { RulesService } from "./rules.service";

describe("RulesService", () => {
  let service: RulesService;

  beforeEach(() => {
    service = new RulesService();
  });

  it("returns default rules for a new user", () => {
    const rules = service.getImportanceRules("u1");

    expect(rules.vipSenders).toEqual([]);
    expect(rules.vipDomains).toEqual([]);
    expect(rules.keywords).toEqual(["urgent", "asap", "deadline", "contract"]);
    expect(rules.mutedDomains).toEqual([]);
  });

  it("updates and persists rules for a user", () => {
    const updated = service.updateImportanceRules("u1", {
      vipSenders: ["ceo@company.com"],
      keywords: ["urgent", "critical"]
    });

    expect(updated.vipSenders).toEqual(["ceo@company.com"]);
    expect(updated.keywords).toEqual(["urgent", "critical"]);
    // Unchanged fields keep their defaults
    expect(updated.vipDomains).toEqual([]);
    expect(updated.mutedDomains).toEqual([]);

    // Persisted across calls
    const fetched = service.getImportanceRules("u1");
    expect(fetched.vipSenders).toEqual(["ceo@company.com"]);
  });

  it("normalizes values to lowercase, trimmed, and unique", () => {
    const updated = service.updateImportanceRules("u1", {
      vipDomains: ["  Company.COM  ", "company.com", "Other.io"],
      keywords: ["URGENT", "urgent", "  ASAP "]
    });

    expect(updated.vipDomains).toEqual(["company.com", "other.io"]);
    expect(updated.keywords).toEqual(["urgent", "asap"]);
  });

  it("filters out empty strings", () => {
    const updated = service.updateImportanceRules("u1", {
      mutedDomains: ["spam.com", "", "  ", "junk.io"]
    });

    expect(updated.mutedDomains).toEqual(["spam.com", "junk.io"]);
  });

  it("isolates rules by user", () => {
    service.updateImportanceRules("u1", { vipSenders: ["alice@a.com"] });
    service.updateImportanceRules("u2", { vipSenders: ["bob@b.com"] });

    expect(service.getImportanceRules("u1").vipSenders).toEqual(["alice@a.com"]);
    expect(service.getImportanceRules("u2").vipSenders).toEqual(["bob@b.com"]);
  });

  it("merges partial updates preserving existing values", () => {
    service.updateImportanceRules("u1", {
      vipSenders: ["alice@a.com"],
      keywords: ["urgent"]
    });

    // Update only keywords
    const updated = service.updateImportanceRules("u1", {
      keywords: ["critical", "deadline"]
    });

    expect(updated.vipSenders).toEqual(["alice@a.com"]); // preserved
    expect(updated.keywords).toEqual(["critical", "deadline"]); // replaced
  });
});
