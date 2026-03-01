import { Injectable } from "@nestjs/common";

import type { ActionProposal, MessageDigest, TimelineCard } from "@mark/contracts";

import { ConnectorsService } from "@/modules/connectors/connectors.service";
import { ComposioActionMapperService } from "@/modules/connectors/composio-action-mapper.service";
import { MemoryService } from "@/modules/memory/memory.service";
import { ImportanceScoringService } from "@/modules/rules/importance-scoring.service";
import { RulesService } from "@/modules/rules/rules.service";

import { AnthropicAdapter } from "./anthropic.adapter";

interface AgentResult {
  reply: string;
  timelineCards: TimelineCard[];
  actionProposals: ActionProposal[];
}

@Injectable()
export class AgentService {
  private readonly importantMessagesByUser = new Map<string, MessageDigest[]>();

  constructor(
    private readonly connectorsService: ConnectorsService,
    private readonly mapper: ComposioActionMapperService,
    private readonly memoryService: MemoryService,
    private readonly rulesService: RulesService,
    private readonly scoringService: ImportanceScoringService,
    private readonly anthropicAdapter: AnthropicAdapter
  ) {}

  async processUtterance(userId: string, text: string): Promise<AgentResult> {
    const normalized = text.toLowerCase();

    if (this.isEmailFetchRequest(normalized)) {
      return this.handleEmailFetch(userId);
    }

    if (this.isImportantDetailsRequest(normalized)) {
      return this.handleImportantDetails(userId);
    }

    // For all other inputs, use Anthropic to generate a response
    const context = await this.memoryService.getContext(userId);
    const emails = this.connectorsService.fetchRecentEmails(userId, 24);
    const emailSummary = emails.length > 0
      ? emails.map((e) => `From: ${e.from} | Subject: ${e.subject}`).join("\n")
      : "";

    const reply = await this.anthropicAdapter.processUtterance(text, {
      emails: emailSummary,
      memory: context.profileNotes.slice(-3).join("; ")
    }, userId);

    await this.memoryService.maybeRemember(userId, `User asked: "${text.slice(0, 80)}"`);

    return {
      reply,
      timelineCards: [],
      actionProposals: []
    };
  }

  private async handleEmailFetch(userId: string): Promise<AgentResult> {
    const emails = this.connectorsService.fetchRecentEmails(userId, 24);
    if (emails.length === 0) {
      return {
        reply: "No connected Gmail inbox yet. Head to the Connections tab to connect Gmail first.",
        timelineCards: [
          {
            id: "",
            type: "error",
            title: "Gmail not connected",
            body: "Connect Gmail in the Connections tab to fetch emails.",
            source: "gmail",
            timestamp: "",
            status: "error"
          }
        ],
        actionProposals: []
      };
    }

    const rules = this.rulesService.getImportanceRules(userId);
    const scored = emails.map((message) => ({
      message,
      score: this.scoringService.score(message, rules)
    }));

    const important = scored.filter((entry) => entry.score.category === "important").map((entry) => entry.message);
    const bulk = scored.filter((entry) => entry.score.category === "bulk");

    this.importantMessagesByUser.set(userId, important);

    const userContext = (await this.memoryService.getContext(userId)).profileNotes;
    const actionProposals: ActionProposal[] = [];

    for (const message of important) {
      const draft = await this.anthropicAdapter.draftReply(message, userContext);
      const proposal = this.mapper.buildProposal({
        connectorId: "gmail",
        action: "email.reply",
        payload: {
          threadId: message.id,
          draft,
          to: message.from
        }
      });
      actionProposals.push(proposal);
    }

    const summary = await this.anthropicAdapter.summarizeEmails(emails.length, important.length, bulk.length);

    await this.memoryService.maybeRemember(userId, `User reviewed inbox summary at ${new Date().toISOString()}`);

    return {
      reply: summary,
      timelineCards: [
        {
          id: "",
          type: "fetch",
          title: "Fetched inbox",
          body: `Pulled ${emails.length} emails from the last 24h.`,
          source: "gmail",
          timestamp: "",
          status: "success"
        },
        {
          id: "",
          type: "analysis",
          title: "Prioritization complete",
          body: `${important.length} important, ${bulk.length} bulk/newsletters, ${emails.length - important.length - bulk.length} normal.`,
          source: "agent",
          timestamp: "",
          status: "success"
        }
      ],
      actionProposals
    };
  }

  private async handleImportantDetails(userId: string): Promise<AgentResult> {
    const important = this.importantMessagesByUser.get(userId) ?? [];
    if (important.length === 0) {
      return {
        reply: "No important emails cached yet. Ask me to check your last 24 hours first.",
        timelineCards: [],
        actionProposals: []
      };
    }

    const [first] = important;
    const context = (await this.memoryService.getContext(userId)).profileNotes;
    const draft = await this.anthropicAdapter.draftReply(first, context);

    const proposal = this.mapper.buildProposal({
      connectorId: "gmail",
      action: "email.reply",
      payload: {
        threadId: first.id,
        draft,
        to: first.from
      }
    });

    return {
      reply: `Top email from ${first.from}: "${first.subject}". I've drafted a reply — say "confirm" to send.`,
      timelineCards: [
        {
          id: "",
          type: "proposal",
          title: "Reply drafted",
          body: `Draft for ${first.from}: ${draft}`,
          source: "agent",
          timestamp: "",
          status: "pending"
        }
      ],
      actionProposals: [proposal]
    };
  }

  private isEmailFetchRequest(normalized: string): boolean {
    return (
      (normalized.includes("check") || normalized.includes("look") || normalized.includes("get") || normalized.includes("fetch") || normalized.includes("show")) &&
      (normalized.includes("mail") || normalized.includes("email") || normalized.includes("inbox"))
    );
  }

  private isImportantDetailsRequest(normalized: string): boolean {
    return (
      normalized.includes("important") &&
      (normalized.includes("what") || normalized.includes("show") || normalized.includes("detail"))
    );
  }
}
