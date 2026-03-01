import { ConfigService } from "@nestjs/config";

import { AnthropicAdapter } from "./anthropic.adapter";

describe("AnthropicAdapter", () => {
  describe("without API key (fallback mode)", () => {
    let adapter: AnthropicAdapter;

    beforeEach(() => {
      const configService = {
        get: jest.fn().mockReturnValue(undefined)
      } as unknown as ConfigService;
      adapter = new AnthropicAdapter(configService);
    });

    it("returns fallback for email-related queries", async () => {
      const reply = await adapter.processUtterance("check my emails", { emails: "", memory: "" });
      expect(reply).toContain("email");
    });

    it("returns greeting for hello", async () => {
      const reply = await adapter.processUtterance("hello", { emails: "", memory: "" });
      expect(reply).toContain("Mark");
    });

    it("returns generic fallback for unknown queries", async () => {
      const reply = await adapter.processUtterance("play some music", { emails: "", memory: "" });
      expect(reply).toBeDefined();
      expect(reply.length).toBeGreaterThan(0);
    });

    it("returns fallback for summarizeEmails", async () => {
      const reply = await adapter.summarizeEmails(10, 3, 5);
      expect(reply).toContain("10");
      expect(reply).toContain("3");
      expect(reply).toContain("5");
    });

    it("returns fallback for draftReply", async () => {
      const reply = await adapter.draftReply(
        {
          id: "m1",
          connectorId: "gmail",
          from: "alice@example.com",
          subject: "Contract review",
          snippet: "Please review the contract.",
          receivedAt: new Date().toISOString()
        },
        []
      );
      expect(reply).toContain("Contract review");
    });

    it("returns static string for clarifyLowConfidence", async () => {
      const reply = await adapter.clarifyLowConfidence();
      expect(reply).toContain("confident");
    });
  });
});
