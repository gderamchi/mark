import type { MessageDigest } from "@mark/contracts";

import { AuditService } from "@/modules/audit/audit.service";
import { ComposioActionMapperService } from "@/modules/connectors/composio-action-mapper.service";
import { ConnectorsService } from "@/modules/connectors/connectors.service";
import { BackboardAdapter } from "@/modules/memory/backboard.adapter";
import { MemoryService } from "@/modules/memory/memory.service";
import { ImportanceScoringService } from "@/modules/rules/importance-scoring.service";
import { RulesService } from "@/modules/rules/rules.service";

import { AnthropicAdapter } from "./anthropic.adapter";
import { AgentService } from "./agent.service";

function createServices() {
  const auditService = new AuditService();
  const connectorsService = new ConnectorsService(auditService);
  const mapper = new ComposioActionMapperService();
  const backboard = new BackboardAdapter({ get: jest.fn().mockReturnValue(undefined) } as any);
  const memoryService = new MemoryService(backboard, auditService);
  const rulesService = new RulesService();
  const scoringService = new ImportanceScoringService();
  const anthropicAdapter = {
    processUtterance: jest.fn().mockResolvedValue("I can help you with that."),
    summarizeEmails: jest.fn().mockResolvedValue("You have 3 emails, 1 is important."),
    draftReply: jest.fn().mockResolvedValue("Thank you for your message.")
  } as unknown as AnthropicAdapter;

  return { auditService, connectorsService, mapper, memoryService, rulesService, scoringService, anthropicAdapter };
}

describe("AgentService", () => {
  it("handles general utterances via Anthropic", async () => {
    const deps = createServices();
    const agent = new AgentService(
      deps.connectorsService, deps.mapper, deps.memoryService,
      deps.rulesService, deps.scoringService, deps.anthropicAdapter
    );

    const result = await agent.processUtterance("u1", "Hello, what can you do?");

    expect(result.reply).toBe("I can help you with that.");
    expect(result.timelineCards).toEqual([]);
    expect(result.actionProposals).toEqual([]);
    expect(deps.anthropicAdapter.processUtterance).toHaveBeenCalledTimes(1);
  });

  it("detects email fetch request and returns no-gmail message when not connected", async () => {
    const deps = createServices();
    const agent = new AgentService(
      deps.connectorsService, deps.mapper, deps.memoryService,
      deps.rulesService, deps.scoringService, deps.anthropicAdapter
    );

    const result = await agent.processUtterance("u1", "Check my emails");

    expect(result.reply).toContain("No connected Gmail");
    expect(result.timelineCards).toHaveLength(1);
    expect(result.timelineCards[0].type).toBe("error");
  });

  it("fetches and scores emails when gmail is connected", async () => {
    const deps = createServices();
    deps.connectorsService.connect("u1", "gmail");

    const agent = new AgentService(
      deps.connectorsService, deps.mapper, deps.memoryService,
      deps.rulesService, deps.scoringService, deps.anthropicAdapter
    );

    const result = await agent.processUtterance("u1", "Check my email inbox");

    expect(deps.anthropicAdapter.summarizeEmails).toHaveBeenCalled();
    expect(result.reply).toBe("You have 3 emails, 1 is important.");
    expect(result.timelineCards.length).toBeGreaterThanOrEqual(2);
    expect(result.timelineCards.some((c) => c.type === "fetch")).toBe(true);
    expect(result.timelineCards.some((c) => c.type === "analysis")).toBe(true);
  });

  it("generates action proposals for important emails", async () => {
    const deps = createServices();
    deps.connectorsService.connect("u1", "gmail");
    // Add VIP sender to make emails "important"
    deps.rulesService.updateImportanceRules("u1", {
      vipSenders: ["ceo@important-client.com"]
    });

    const agent = new AgentService(
      deps.connectorsService, deps.mapper, deps.memoryService,
      deps.rulesService, deps.scoringService, deps.anthropicAdapter
    );

    const result = await agent.processUtterance("u1", "Get my emails");

    expect(result.actionProposals.length).toBeGreaterThan(0);
    expect(result.actionProposals[0].connectorId).toBe("gmail");
    expect(result.actionProposals[0].action).toBe("email.reply");
    expect(deps.anthropicAdapter.draftReply).toHaveBeenCalled();
  });

  it("handles 'show important details' request", async () => {
    const deps = createServices();
    deps.connectorsService.connect("u1", "gmail");
    deps.rulesService.updateImportanceRules("u1", {
      vipSenders: ["ceo@important-client.com"]
    });

    const agent = new AgentService(
      deps.connectorsService, deps.mapper, deps.memoryService,
      deps.rulesService, deps.scoringService, deps.anthropicAdapter
    );

    // First: fetch emails to populate cache
    await agent.processUtterance("u1", "Check my emails");

    // Then: ask for important details
    const result = await agent.processUtterance("u1", "What are the important details?");

    expect(result.reply).toContain("Top email from");
    expect(result.timelineCards).toHaveLength(1);
    expect(result.timelineCards[0].type).toBe("proposal");
    expect(result.actionProposals).toHaveLength(1);
  });

  it("returns fallback when no important emails are cached for details request", async () => {
    const deps = createServices();
    const agent = new AgentService(
      deps.connectorsService, deps.mapper, deps.memoryService,
      deps.rulesService, deps.scoringService, deps.anthropicAdapter
    );

    const result = await agent.processUtterance("u1", "Show me important details");

    expect(result.reply).toContain("No important emails cached");
    expect(result.timelineCards).toEqual([]);
  });

  it("remembers user interactions in memory", async () => {
    const deps = createServices();
    const agent = new AgentService(
      deps.connectorsService, deps.mapper, deps.memoryService,
      deps.rulesService, deps.scoringService, deps.anthropicAdapter
    );

    await agent.processUtterance("u1", "Hello, what can you do?");

    const context = await deps.memoryService.getContext("u1");
    expect(context.profileNotes.length).toBeGreaterThan(0);
    expect(context.profileNotes[0]).toContain("User asked:");
  });

  describe("intent detection", () => {
    const emailTriggers = [
      "check my emails",
      "look at my email",
      "get my inbox",
      "fetch my mail",
      "show me my emails"
    ];

    it.each(emailTriggers)("detects email fetch request: '%s'", async (text) => {
      const deps = createServices();
      const agent = new AgentService(
        deps.connectorsService, deps.mapper, deps.memoryService,
        deps.rulesService, deps.scoringService, deps.anthropicAdapter
      );

      const result = await agent.processUtterance("u1", text);
      // Should not call processUtterance on anthropic (it's an email fetch)
      expect(deps.anthropicAdapter.processUtterance).not.toHaveBeenCalled();
    });
  });
});
