import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";

import type { MessageDigest } from "@mark/contracts";

@Injectable()
export class AnthropicAdapter {
  private readonly logger = new Logger(AnthropicAdapter.name);
  private client: Anthropic | null = null;
  /** Per-user conversation history (kept in memory, last 20 turns) */
  private readonly history = new Map<string, Anthropic.MessageParam[]>();
  private static readonly MAX_HISTORY = 20;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("ANTHROPIC_API_KEY");
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      this.logger.warn("ANTHROPIC_API_KEY not set — using fallback responses");
    }
  }

  private getHistory(userId: string): Anthropic.MessageParam[] {
    if (!this.history.has(userId)) {
      this.history.set(userId, []);
    }
    return this.history.get(userId)!;
  }

  private pushTurn(userId: string, role: "user" | "assistant", content: string): void {
    const turns = this.getHistory(userId);
    turns.push({ role, content });
    // Keep only last N turns
    while (turns.length > AnthropicAdapter.MAX_HISTORY) {
      turns.shift();
    }
  }

  async processUtterance(userText: string, context: { emails: string; memory: string }, userId?: string): Promise<string> {
    if (!this.client) {
      return this.fallbackProcess(userText);
    }

    const uid = userId ?? "default";
    this.pushTurn(uid, "user", userText);

    try {
      const message = await this.client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: `You are Mark, a concise voice assistant. You help users manage emails, messages, and tasks across connected platforms.
Keep responses short (2-3 sentences max) and conversational — this is spoken aloud.
${context.memory ? `User context: ${context.memory}` : ""}
${context.emails ? `Available emails:\n${context.emails}` : ""}`,
        messages: this.getHistory(uid)
      });

      if (message.stop_reason === "max_tokens") {
        this.logger.warn("processUtterance response was truncated (max_tokens reached)");
      }

      const block = message.content[0];
      if (!block || block.type !== "text") {
        return "I could not process that request.";
      }

      this.pushTurn(uid, "assistant", block.text);
      return block.text;
    } catch (err) {
      this.logger.error("Anthropic API error in processUtterance", err);
      // Remove the user turn that failed
      const turns = this.getHistory(uid);
      turns.pop();
      return this.fallbackProcess(userText);
    }
  }

  async summarizeEmails(total: number, important: number, bulk: number): Promise<string> {
    const fallback = `You have ${total} new emails. ${important} need attention, ${bulk} are newsletters.`;
    if (!this.client) {
      return fallback;
    }

    try {
      const message = await this.client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 150,
        system: "You are Mark, a concise voice assistant. Summarize email stats in 1-2 spoken sentences. Be natural and brief.",
        messages: [{
          role: "user",
          content: `Summarize: ${total} emails total, ${important} important, ${bulk} bulk/newsletters.`
        }]
      });

      if (message.stop_reason === "max_tokens") {
        this.logger.warn("summarizeEmails response was truncated (max_tokens reached)");
      }

      const block = message.content[0];
      if (!block || block.type !== "text") {
        return fallback;
      }
      return block.text;
    } catch (err) {
      this.logger.error("Anthropic API error in summarizeEmails", err);
      return fallback;
    }
  }

  async draftReply(message: MessageDigest, userContext: string[]): Promise<string> {
    const fallback = `Thanks for your message about "${message.subject}". I've reviewed it and will respond with next steps today.`;
    if (!this.client) {
      return fallback;
    }

    try {
      const contextLine = userContext.length > 0 ? `User preferences: ${userContext.slice(-3).join("; ")}` : "";
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        system: `You are drafting a professional email reply on behalf of the user. Be concise, professional, and natural. ${contextLine}`,
        messages: [{
          role: "user",
          content: `Draft a reply to this email:\nFrom: ${message.from}\nSubject: ${message.subject}\nSnippet: ${message.snippet}`
        }]
      });

      if (response.stop_reason === "max_tokens") {
        this.logger.warn("draftReply response was truncated (max_tokens reached)");
      }

      const block = response.content[0];
      if (!block || block.type !== "text") {
        return fallback;
      }
      return block.text;
    } catch (err) {
      this.logger.error("Anthropic API error in draftReply", err);
      return fallback;
    }
  }

  async clarifyLowConfidence(): Promise<string> {
    return "I'm not fully confident about this action. Should I ask a follow-up question before proceeding?";
  }

  private fallbackProcess(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes("mail") || lower.includes("email")) {
      return "I can check your emails. Try: check my emails from the last 24 hours.";
    }
    if (lower.includes("hello") || lower.includes("hi")) {
      return "Hey! I'm Mark, your voice assistant. I can check your emails, manage connections, and help you stay on top of things.";
    }
    return "I can help you manage emails and connected platforms. What would you like to do?";
  }
}
