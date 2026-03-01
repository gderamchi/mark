import type { EnvConfig } from "./env.js";
import type {
  EmailPriorityClassifier,
  EmailPriorityDecision,
  TriageInputEmail,
  TriagedEmailCategory
} from "./gmailInboxTriage.js";

type AnthropicMessageResponse = {
  content?: Array<Record<string, unknown>>;
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CLASSIFY_BATCH_SIZE = 60;

export class GmailPriorityLlmClassifier implements EmailPriorityClassifier {
  constructor(private readonly env: EnvConfig) {}

  isConfigured(): boolean {
    return Boolean(this.env.anthropicApiKey);
  }

  async classify(emails: TriageInputEmail[]): Promise<Record<string, EmailPriorityDecision>> {
    if (!this.env.anthropicApiKey || emails.length === 0) {
      return {};
    }

    const result: Record<string, EmailPriorityDecision> = {};

    for (let index = 0; index < emails.length; index += CLASSIFY_BATCH_SIZE) {
      const batch = emails.slice(index, index + CLASSIFY_BATCH_SIZE);
      try {
        const decisions = await this.classifyBatch(batch);
        for (const decision of decisions) {
          result[decision.id] = {
            category: sanitizeCategory(decision.category),
            reason: compactText(decision.reason || "Prioritized by language model triage.", 140)
          };
        }
      } catch {
        // If one batch fails, keep the pipeline alive and fallback to heuristic.
      }
    }

    return result;
  }

  private async classifyBatch(batch: TriageInputEmail[]): Promise<Array<{ id: string; category: TriagedEmailCategory; reason: string }>> {
    const payload = {
      emails: batch.map((email) => ({
        id: email.id,
        from: compactText(email.from, 120),
        senderKind: inferSenderKind(email.from),
        subject: compactText(email.subject, 160),
        isThreadLike: /^(\s*(re|fwd?|fw):)/i.test(email.subject),
        snippet: compactText(email.snippet, 180),
        labelIds: email.labelIds.slice(0, 8),
        timestamp: email.timestamp
      }))
    };

    const response = await this.callAnthropic(payload);
    const rawText = extractText(response);
    const parsed = tryParseJson(rawText);

    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).items)) {
      return [];
    }

    const items = (parsed as Record<string, unknown>).items as unknown[];
    const allowedIds = new Set(batch.map((email) => email.id));

    const decisions: Array<{ id: string; category: TriagedEmailCategory; reason: string }> = [];
    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== "object") {
        continue;
      }
      const item = rawItem as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id : "";
      if (!id || !allowedIds.has(id)) {
        continue;
      }
      const category = sanitizeCategory(typeof item.category === "string" ? item.category : "optional");
      const reason = typeof item.reason === "string" ? item.reason : "Prioritized by language model triage.";
      decisions.push({
        id,
        category,
        reason
      });
    }

    return decisions;
  }

  private async callAnthropic(payload: Record<string, unknown>): Promise<AnthropicMessageResponse> {
    if (!this.env.anthropicApiKey) {
      return {};
    }

    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.env.anthropicApiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.env.anthropicModel,
        max_tokens: 1_500,
        temperature: 0,
        system: [
          "You classify inbox emails for a voice assistant.",
          "Return JSON only with this exact shape:",
          '{"items":[{"id":"...","category":"respond_needed|must_know|optional","reason":"short reason"}]}',
          "Classification policy:",
          "- must_know: only urgent, high-impact risk where missing it could cause harm or loss (security breach, payment failure on critical account, legal/compliance deadline, account lockout, severe service incident).",
          "- respond_needed: the sender is clearly expecting a response/decision and replying would provide meaningful user value.",
          "- optional: everything else (newsletters, promos, digests, verification/welcome emails, routine invitations, low-context outreach, generic notifications).",
          "Prioritize precision over recall: false positives are worse than false negatives.",
          "must_know must be rare. In a normal inbox this is usually a small minority.",
          "If uncertain between must_know and respond_needed, choose respond_needed.",
          "If uncertain between respond_needed and optional, choose optional.",
          "Use semantic cues in any language (not only English).",
          "An email verification code, signup confirmation, or routine invitation is optional unless there is explicit urgent impact.",
          "A work proposal, recruiting message, interview process step, or direct business inquiry is usually respond_needed, not must_know.",
          "Do not classify generic cold outreach as respond_needed unless there is a concrete ask, clear relevance, or clear next step.",
          "Do not rely on senderKind alone: automated platform senders can still contain response-worthy opportunities."
        ].join(" "),
        messages: [
          {
            role: "user",
            content: JSON.stringify(payload)
          }
        ]
      })
    });

    if (!response.ok) {
      const text = await safeText(response);
      throw new Error(`Anthropic classify error ${response.status}: ${text}`);
    }

    return (await response.json()) as AnthropicMessageResponse;
  }
}

function inferSenderKind(sender: string): "automated_or_system" | "human_or_unknown" {
  const normalized = sender.toLowerCase();
  if (/(no[-_. ]?reply|noreply|notifications?|mailer-daemon|do[-_. ]?not[-_. ]?reply)/.test(normalized)) {
    return "automated_or_system";
  }
  return "human_or_unknown";
}

function sanitizeCategory(category: string): TriagedEmailCategory {
  if (category === "must_know" || category === "respond_needed" || category === "optional") {
    return category;
  }
  return "optional";
}

function extractText(data: AnthropicMessageResponse): string {
  const content = Array.isArray(data.content) ? data.content : [];
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n")
    .trim();
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    const extracted = value.match(/\{[\s\S]*\}/)?.[0];
    if (!extracted) {
      return null;
    }
    try {
      return JSON.parse(extracted);
    } catch {
      return null;
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function compactText(value: string, maxChars: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxChars) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, maxChars - 15))}...(truncated)`;
}
