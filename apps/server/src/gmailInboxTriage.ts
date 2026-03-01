import { ComposioService, type AgentToolDefinition } from "./composio.js";

export type TriagedEmailCategory = "respond_needed" | "must_know" | "optional";

export type TriagedEmail = {
  id: string;
  threadId: string | null;
  from: string;
  subject: string;
  timestamp: string | null;
  snippet: string;
  labelIds: string[];
  category: TriagedEmailCategory;
  reason: string;
};

export type TriageInputEmail = {
  id: string;
  from: string;
  subject: string;
  timestamp: string | null;
  snippet: string;
  labelIds: string[];
};

export type EmailPriorityDecision = {
  category: TriagedEmailCategory;
  reason: string;
};

export interface EmailPriorityClassifier {
  isConfigured(): boolean;
  classify(emails: TriageInputEmail[]): Promise<Record<string, EmailPriorityDecision>>;
}

export type GmailTriageResult = {
  resolvedQuery: string;
  windowLabel: string;
  timeZone: string;
  scannedCount: number;
  pagesFetched: number;
  capHit: boolean;
  durationMs: number;
  llmClassifiedCount: number;
  heuristicClassifiedCount: number;
  respondNeeded: TriagedEmail[];
  mustKnow: TriagedEmail[];
  optionalCount: number;
  decisionAudit: Array<{
    id: string;
    from: string;
    subject: string;
    category: TriagedEmailCategory;
    source: "heuristic_lock" | "llm" | "llm_promoted" | "fallback";
    reason: string;
    snippetLen: number;
    labelIds: string[];
  }>;
};

type TriageParams = {
  composioUserId: string;
  toolsByName: Record<string, AgentToolDefinition>;
  resolvedQuery: string;
  windowLabel: string;
  timeZone: string;
  maxEmails?: number;
  concurrency?: number;
};

type MessageRef = {
  id: string;
  threadId: string | null;
};

type CompactEmail = {
  id: string;
  threadId: string | null;
  from: string;
  subject: string;
  timestamp: string | null;
  snippet: string;
  labelIds: string[];
};

type HeuristicClassification = {
  locked: boolean;
  category: TriagedEmailCategory;
  reason: string;
};

const DEFAULT_MAX_EMAILS = 2_000;
const LIST_PAGE_SIZE = 100;
const DEFAULT_CONCURRENCY = 6;
const EMPTY_SNIPPET_ENRICH_LIMIT = 240;

export class GmailInboxTriageService {
  constructor(
    private readonly composio: ComposioService,
    private readonly classifier?: EmailPriorityClassifier
  ) {}

  async triageInbox(params: TriageParams): Promise<GmailTriageResult> {
    const startedAt = Date.now();
    const maxEmails = Math.max(1, params.maxEmails ?? DEFAULT_MAX_EMAILS);
    const concurrency = Math.max(1, params.concurrency ?? DEFAULT_CONCURRENCY);

    const listTool = this.getToolBySlug(params.toolsByName, "GMAIL_LIST_MESSAGES");
    const metadataTool = this.getToolBySlug(params.toolsByName, "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID");
    if (!listTool || !metadataTool) {
      throw new Error("Gmail read tools are unavailable for this user.");
    }

    const refs: MessageRef[] = [];
    const seenIds = new Set<string>();

    let pageToken: string | null = null;
    let pagesFetched = 0;
    let capHit = false;

    while (true) {
      const listArgs: Record<string, unknown> = {
        q: params.resolvedQuery,
        max_results: LIST_PAGE_SIZE,
        include_spam_trash: false
      };
      if (pageToken) {
        listArgs.page_token = pageToken;
      }

      const listRaw = await this.composio.executeTool(params.composioUserId, listTool, listArgs);
      pagesFetched += 1;

      const page = parseListPage(listRaw);
      for (const message of page.messages) {
        if (seenIds.has(message.id)) {
          continue;
        }
        seenIds.add(message.id);
        refs.push(message);
        if (refs.length >= maxEmails) {
          capHit = true;
          break;
        }
      }

      if (capHit || !page.nextPageToken) {
        capHit = capHit || Boolean(page.nextPageToken);
        break;
      }

      pageToken = page.nextPageToken;
    }

    const compactEmails = await mapWithConcurrency(refs, concurrency, async (ref) => {
      try {
        const metadataRaw = await this.composio.executeTool(params.composioUserId, metadataTool, {
          message_id: ref.id,
          format: "metadata"
        });
        return parseMetadataEmail(metadataRaw, ref);
      } catch {
        return {
          id: ref.id,
          threadId: ref.threadId,
          from: "Unknown sender",
          subject: "(Unable to read subject)",
          timestamp: null,
          snippet: "",
          labelIds: []
        } satisfies CompactEmail;
      }
    });

    const enrichedEmails = await this.enrichEmptySnippets(
      params.composioUserId,
      metadataTool,
      compactEmails,
      Math.min(EMPTY_SNIPPET_ENRICH_LIMIT, maxEmails),
      Math.max(1, Math.min(concurrency, 4))
    );

    const sorted = enrichedEmails.sort(compareByTimestampDescThenId);
    const unreadSorted = sorted.filter(hasUnreadLabel);

    const classifications = new Map<string, EmailPriorityDecision>();
    const decisionSourceById = new Map<string, "heuristic_lock" | "llm" | "llm_promoted" | "fallback">();
    const undecided: CompactEmail[] = [];
    let heuristicClassifiedCount = 0;

    for (const email of unreadSorted) {
      const heuristic = classifyEmailHeuristic(email);
      if (heuristic.locked) {
        classifications.set(email.id, {
          category: heuristic.category,
          reason: heuristic.reason
        });
        decisionSourceById.set(email.id, "heuristic_lock");
        heuristicClassifiedCount += 1;
        continue;
      }
      undecided.push(email);
    }

    let llmClassifiedCount = 0;
    if (this.classifier?.isConfigured() && undecided.length > 0) {
      const llmInput = undecided.map(toTriageInputEmail);
      const llmDecisions = await this.classifier.classify(llmInput);
      for (const email of undecided) {
        const decision = llmDecisions[email.id];
        if (!decision) {
          continue;
        }
        let category = sanitizeCategory(decision.category);
        let reason = compactText(decision.reason, 140) || "Prioritized by language model triage.";
        let source: "llm" | "llm_promoted" = "llm";

        if (category === "optional" && shouldPromoteOptionalToRespondNeeded(email)) {
          category = "respond_needed";
          reason = "Promoted from optional because direct response-request cues were detected.";
          source = "llm_promoted";
        }

        classifications.set(email.id, {
          category,
          reason
        });
        decisionSourceById.set(email.id, source);
        llmClassifiedCount += 1;
      }
    }

    for (const email of undecided) {
      if (classifications.has(email.id)) {
        continue;
      }
      const fallback = classifyEmailFallback(email);
      classifications.set(email.id, {
        category: fallback.category,
        reason: fallback.reason
      });
      decisionSourceById.set(email.id, "fallback");
      heuristicClassifiedCount += 1;
    }

    const respondNeeded: TriagedEmail[] = [];
    const mustKnow: TriagedEmail[] = [];
    let optionalCount = 0;

    for (const email of unreadSorted) {
      const decision = classifications.get(email.id) ?? {
        category: "optional",
        reason: "Low-priority update or digest."
      };
      const triaged: TriagedEmail = {
        ...email,
        category: decision.category,
        reason: decision.reason
      };
      if (decision.category === "respond_needed") {
        respondNeeded.push(triaged);
      } else if (decision.category === "must_know") {
        mustKnow.push(triaged);
      } else {
        optionalCount += 1;
      }
    }

    const decisionAudit = unreadSorted.map((email) => {
      const decision = classifications.get(email.id) ?? {
        category: "optional" as const,
        reason: "Low-priority update or digest."
      };
      return {
        id: email.id,
        from: email.from,
        subject: email.subject,
        category: decision.category,
        source: decisionSourceById.get(email.id) ?? "fallback",
        reason: decision.reason,
        snippetLen: email.snippet.length,
        labelIds: email.labelIds
      };
    });

    return {
      resolvedQuery: params.resolvedQuery,
      windowLabel: params.windowLabel,
      timeZone: params.timeZone,
      scannedCount: unreadSorted.length,
      pagesFetched,
      capHit,
      durationMs: Date.now() - startedAt,
      llmClassifiedCount,
      heuristicClassifiedCount,
      respondNeeded,
      mustKnow,
      optionalCount,
      decisionAudit
    };
  }

  private getToolBySlug(toolsByName: Record<string, AgentToolDefinition>, toolSlug: string): AgentToolDefinition | null {
    for (const tool of Object.values(toolsByName)) {
      if (tool.toolSlug === toolSlug) {
        return tool;
      }
    }
    return null;
  }

  private async enrichEmptySnippets(
    composioUserId: string,
    metadataTool: AgentToolDefinition,
    emails: CompactEmail[],
    maxEnriched: number,
    concurrency: number
  ): Promise<CompactEmail[]> {
    const needsEnrichment = emails.filter((email) => shouldEnrichEmptySnippet(email)).slice(0, maxEnriched);
    if (needsEnrichment.length === 0) {
      return emails;
    }

    const enrichedById = new Map<string, CompactEmail>();
    await mapWithConcurrency(needsEnrichment, concurrency, async (email) => {
      try {
        const fullRaw = await this.composio.executeTool(composioUserId, metadataTool, {
          message_id: email.id,
          format: "full"
        });
        const enriched = parseMetadataEmail(fullRaw, {
          id: email.id,
          threadId: email.threadId
        });
        if (enriched.snippet.length > 0) {
          enrichedById.set(email.id, {
            ...email,
            snippet: enriched.snippet
          });
        }
      } catch {
        // Keep original metadata record when enrichment fails.
      }
      return null;
    });

    if (enrichedById.size === 0) {
      return emails;
    }

    return emails.map((email) => enrichedById.get(email.id) ?? email);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function parseListPage(raw: unknown): { messages: MessageRef[]; nextPageToken: string | null } {
  const data = unwrapData(raw);
  const messagesRaw = asArray(data.messages);
  const messages: MessageRef[] = [];

  for (const entry of messagesRaw) {
    const item = asObject(entry);
    if (!item) {
      continue;
    }
    const id = readString(item, "id") ?? readString(item, "messageId");
    if (!id) {
      continue;
    }
    messages.push({
      id,
      threadId: readString(item, "threadId")
    });
  }

  return {
    messages,
    nextPageToken: readString(data, "nextPageToken")
  };
}

function parseMetadataEmail(raw: unknown, ref: MessageRef): CompactEmail {
  const data = unwrapData(raw);
  const payload = asObject(data.payload);

  const subject = pickFirst([readString(data, "subject"), readHeader(payload, "Subject")]);
  const sender = pickFirst([readString(data, "sender"), readHeader(payload, "From")]);
  const timestamp = normalizeTimestamp(
    pickFirst([readString(data, "messageTimestamp"), readString(data, "internalDate"), readHeader(payload, "Date")])
  );
  const snippet = pickFirst([readString(data, "preview"), readString(data, "snippet"), readString(data, "messageText")]);

  return {
    id: readString(data, "messageId") ?? ref.id,
    threadId: readString(data, "threadId") ?? ref.threadId,
    from: compactText(sender ?? "Unknown sender", 130),
    subject: compactText(subject ?? "(No subject)", 170),
    timestamp,
    snippet: compactText(snippet ?? "", 220),
    labelIds: readStringArray(data.labelIds)
  };
}

function toTriageInputEmail(email: CompactEmail): TriageInputEmail {
  return {
    id: email.id,
    from: email.from,
    subject: email.subject,
    timestamp: email.timestamp,
    snippet: email.snippet,
    labelIds: email.labelIds
  };
}

function classifyEmailHeuristic(email: CompactEmail): HeuristicClassification {
  const labelSet = new Set(email.labelIds.map((label) => label.toUpperCase()));
  const subject = email.subject.toLowerCase();
  const sender = email.from.toLowerCase();
  const snippet = email.snippet.toLowerCase();
  const haystack = `${subject} ${sender} ${snippet}`;

  if (isStrictMustKnow(labelSet, haystack)) {
    return {
      locked: true,
      category: "must_know",
      reason: "Critical account, security, or billing alert."
    };
  }

  return {
    locked: false,
    category: isStrongRespondNeeded(haystack, sender) ? "respond_needed" : "optional",
    reason: "Needs language-model triage."
  };
}

function classifyEmailFallback(email: CompactEmail): EmailPriorityDecision {
  const labelSet = new Set(email.labelIds.map((label) => label.toUpperCase()));
  const subject = email.subject.toLowerCase();
  const sender = email.from.toLowerCase();
  const snippet = email.snippet.toLowerCase();
  const haystack = `${subject} ${sender} ${snippet}`;

  if (isStrictMustKnow(labelSet, haystack)) {
    return {
      category: "must_know",
      reason: "Critical account or billing signal detected."
    };
  }

  if (isStrongOptional(labelSet, haystack, sender)) {
    return {
      category: "optional",
      reason: "Automated, promotional, or routine low-priority email."
    };
  }

  if (isStrongRespondNeeded(haystack, sender) || isModerateRespondNeeded(haystack, sender)) {
    return {
      category: "respond_needed",
      reason: "Likely requests a direct response with meaningful follow-up."
    };
  }

  return {
    category: "optional",
    reason: "Low-priority informational update."
  };
}

function isStrictMustKnow(labelSet: Set<string>, haystack: string): boolean {
  if (labelSet.has("IMPORTANT") && /(security|billing|payment|invoice|critical|suspended|unauthorized)/.test(haystack)) {
    return true;
  }

  const strictSignals = [
    "security alert",
    "suspicious login",
    "unauthorized",
    "account locked",
    "password changed",
    "failed payment",
    "payment failed",
    "invoice overdue",
    "account suspended",
    "service disruption",
    "breach",
    "critical incident",
    "critical alert"
  ];

  return strictSignals.some((signal) => haystack.includes(signal));
}

function isStrongOptional(labelSet: Set<string>, haystack: string, sender: string): boolean {
  const promoLabels = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];
  if (promoLabels.some((label) => labelSet.has(label))) {
    return true;
  }

  const verificationSignals = [
    "verify your email",
    "email verification",
    "confirm your email",
    "verification email",
    "welcome to",
    "newsletter",
    "weekly digest",
    "daily digest",
    "unsubscribe"
  ];

  if (verificationSignals.some((signal) => haystack.includes(signal))) {
    return true;
  }

  const automatedSender = isLikelyAutomatedSender(sender);
  if (automatedSender && !/(proposal|interview|contract|opportunity|meeting|client|reply|response)/.test(haystack)) {
    return true;
  }

  return false;
}

function isStrongRespondNeeded(haystack: string, sender: string): boolean {
  if (isLikelyAutomatedSender(sender)) {
    return false;
  }

  const explicitSignals = [
    "please reply",
    "please respond",
    "response needed",
    "action required",
    "approval needed",
    "let me know",
    "can you",
    "could you",
    "would you",
    "follow up",
    "follow-up",
    "rsvp",
    "your feedback",
    "need your input",
    "are you available",
    "what do you think",
    "does this work for you"
  ];

  return explicitSignals.some((signal) => haystack.includes(signal));
}

function isModerateRespondNeeded(haystack: string, sender: string): boolean {
  if (isLikelyAutomatedSender(sender)) {
    return false;
  }

  const workSignals = [
    "proposal",
    "work with",
    "opportunity",
    "partnership",
    "interview",
    "meeting request",
    "contract",
    "quote request",
    "estimate request",
    "project brief",
    "client",
    "collaboration",
    "consulting",
    "next steps"
  ];

  if (workSignals.some((signal) => haystack.includes(signal))) {
    return true;
  }

  if (/(\bre:|\bfwd:|\bfw:)/.test(haystack) && /\b(question|feedback|availability|schedule|next steps)\b/.test(haystack)) {
    return true;
  }

  return false;
}

function hasDirectResponseAskCue(haystack: string): boolean {
  return /\b(let me know|if (you('| a)re|you are) interested|are you interested|leave me a word|can we|could we|would you|shall we|please reply|reply)\b/.test(
    haystack
  );
}

function shouldPromoteOptionalToRespondNeeded(email: CompactEmail): boolean {
  const sender = email.from.toLowerCase();
  const subject = email.subject.toLowerCase();
  const snippet = email.snippet.toLowerCase();
  const haystack = `${subject} ${sender} ${snippet}`;

  if (isStrongRespondNeeded(haystack, sender)) {
    return true;
  }
  if (isModerateRespondNeeded(haystack, sender) && hasDirectResponseAskCue(haystack)) {
    return true;
  }
  return false;
}

function sanitizeCategory(category: TriagedEmailCategory | string): TriagedEmailCategory {
  if (category === "must_know" || category === "respond_needed" || category === "optional") {
    return category;
  }
  return "optional";
}

function hasUnreadLabel(email: CompactEmail): boolean {
  return email.labelIds.some((label) => label.toUpperCase() === "UNREAD");
}

function shouldEnrichEmptySnippet(email: CompactEmail): boolean {
  if (email.snippet.trim().length > 0) {
    return false;
  }
  if (!hasUnreadLabel(email)) {
    return false;
  }
  return true;
}

function isLikelyAutomatedSender(sender: string): boolean {
  return /(no[-_. ]?reply|noreply|notifications?|mailer-daemon|do[-_. ]?not[-_. ]?reply)/.test(sender);
}

function compareByTimestampDescThenId(a: CompactEmail, b: CompactEmail): number {
  const aTime = a.timestamp ? Date.parse(a.timestamp) : Number.NaN;
  const bTime = b.timestamp ? Date.parse(b.timestamp) : Number.NaN;
  const aScore = Number.isFinite(aTime) ? aTime : 0;
  const bScore = Number.isFinite(bTime) ? bTime : 0;
  if (aScore !== bScore) {
    return bScore - aScore;
  }
  return a.id.localeCompare(b.id);
}

function unwrapData(raw: unknown): Record<string, unknown> {
  const root = asObject(raw);
  if (!root) {
    return {};
  }
  const data = asObject(root.data);
  return data ?? root;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function readHeader(payload: Record<string, unknown> | null, headerName: string): string | null {
  if (!payload) {
    return null;
  }
  const headers = asArray(payload.headers);
  for (const rawHeader of headers) {
    const header = asObject(rawHeader);
    if (!header) {
      continue;
    }
    const name = readString(header, "name");
    if (!name || name.toLowerCase() !== headerName.toLowerCase()) {
      continue;
    }
    return readString(header, "value");
  }
  return null;
}

function normalizeTimestamp(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    const millis = asNumber > 9_999_999_999 ? asNumber : asNumber * 1000;
    return new Date(millis).toISOString();
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function pickFirst(values: Array<string | null>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function compactText(value: string, maxChars: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxChars) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, maxChars - 15))}...(truncated)`;
}
