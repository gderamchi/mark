export type EmailIntent =
  | {
      kind: "triage";
      resolvedQuery: string;
      windowLabel: string;
      timeZone: string;
      window: "last_24_hours" | "today" | "yesterday" | "relative_hours";
      windowHours?: number;
    }
  | {
      kind: "continue_important";
    };

type DetectOptions = {
  timeZone: string | null | undefined;
  now?: Date;
};

const MAIL_WORD_PATTERN = /\b(email|emails|inbox|mail|mails)\b/i;
const READ_PATTERN =
  /\b(check|list|show|read|scan|review|look|find|summari[sz]e|triage|what|v[ée]rifie|liste|montre|affiche|lis|regarde|trouve|r[ée]sum[ée]|trie|ram[eè]ne|r[ée]cup[èe]re)\b/i;
const MUTATING_PATTERN = /\b(send|reply|forward|delete|archive|draft|compose|create|write|trash|envoie|r[ée]pond|supprime|archive)\b/i;
const CONTINUE_PATTERN =
  /\b(continue|next|more)\b.*\b(important|priority|filtered)\b.*\b(email|emails|mail|mails)\b|\bdetails?\b.*\b(filtered|important)\b/i;

const LAST_24_HOURS_PATTERN = /\b(last|past)\s*24\s*h(?:ours?)?\b|\blast\s*day\b/i;
const TODAY_PATTERN = /\btoday\b/i;
const YESTERDAY_PATTERN = /\byesterday\b/i;
const LAST_N_HOURS_PATTERN = /\b(?:last|past|previous|derni(?:e|è)res?)\s*(\d{1,3})\s*(?:h|hr|hrs|hour|hours|heure|heures)\b/i;
const LAST_ONE_HOUR_PATTERN = /\b(?:last|past|previous|derni(?:e|è)re?)\s*(?:hour|heure)\b/i;
const N_HOURS_ALT_PATTERN =
  /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:derni(?:e|è)res?\s*)?(?:h|hr|hrs|hour|hours|heure|heures)\b/i;

type ResolvedWindow =
  | { kind: "last_24_hours" }
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "relative_hours"; hours: number };

export class EmailIntentRouter {
  detect(rawText: string, options: DetectOptions): EmailIntent | null {
    const text = rawText.trim();
    if (text.length === 0) {
      return null;
    }

    const normalizedTimeZone = normalizeTimeZone(options.timeZone);
    const now = options.now ?? new Date();

    if (CONTINUE_PATTERN.test(text)) {
      return { kind: "continue_important" };
    }

    if (!MAIL_WORD_PATTERN.test(text)) {
      return null;
    }

    if (MUTATING_PATTERN.test(text)) {
      return null;
    }

    if (!READ_PATTERN.test(text) && !containsRelativeWindow(text)) {
      return null;
    }

    const window = resolveWindow(text);
    const resolvedQuery = buildWindowQuery(window, normalizedTimeZone, now);
    return {
      kind: "triage",
      resolvedQuery,
      windowLabel: windowLabel(window),
      timeZone: normalizedTimeZone,
      window: window.kind,
      windowHours: window.kind === "relative_hours" ? window.hours : undefined
    };
  }
}

function containsRelativeWindow(text: string): boolean {
  return (
    LAST_24_HOURS_PATTERN.test(text) ||
    TODAY_PATTERN.test(text) ||
    YESTERDAY_PATTERN.test(text) ||
    LAST_N_HOURS_PATTERN.test(text) ||
    LAST_ONE_HOUR_PATTERN.test(text)
  );
}

function resolveWindow(text: string): ResolvedWindow {
  if (YESTERDAY_PATTERN.test(text)) {
    return { kind: "yesterday" };
  }
  if (TODAY_PATTERN.test(text)) {
    return { kind: "today" };
  }
  if (LAST_24_HOURS_PATTERN.test(text)) {
    return { kind: "last_24_hours" };
  }

  const parsedHours = extractRelativeHours(text);
  if (parsedHours) {
    return {
      kind: "relative_hours",
      hours: parsedHours
    };
  }

  if (LAST_ONE_HOUR_PATTERN.test(text)) {
    return {
      kind: "relative_hours",
      hours: 1
    };
  }
  return { kind: "last_24_hours" };
}

function windowLabel(window: ResolvedWindow): string {
  if (window.kind === "today") {
    return "today";
  }
  if (window.kind === "yesterday") {
    return "yesterday";
  }
  if (window.kind === "relative_hours") {
    return `the last ${window.hours} hour${window.hours > 1 ? "s" : ""}`;
  }
  return "the last 24 hours";
}

function buildWindowQuery(window: ResolvedWindow, timeZone: string, now: Date): string {
  if (window.kind === "last_24_hours") {
    return "newer_than:1d label:inbox is:unread";
  }
  if (window.kind === "relative_hours") {
    return `newer_than:${window.hours}h label:inbox is:unread`;
  }

  const parts = getDatePartsInTimeZone(now, timeZone);
  const todayUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  if (window.kind === "today") {
    const tomorrowUtc = addUtcDays(todayUtc, 1);
    return `after:${formatGmailDate(todayUtc)} before:${formatGmailDate(tomorrowUtc)} label:inbox is:unread`;
  }

  const yesterdayUtc = addUtcDays(todayUtc, -1);
  return `after:${formatGmailDate(yesterdayUtc)} before:${formatGmailDate(todayUtc)} label:inbox is:unread`;
}

function getDatePartsInTimeZone(now: Date, timeZone: string): { year: number; month: number; day: number } {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const parts = formatter.formatToParts(now);
    const year = readPart(parts, "year");
    const month = readPart(parts, "month");
    const day = readPart(parts, "day");
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return { year, month, day };
    }
  } catch {
    // Falls back to UTC below.
  }

  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate()
  };
}

function readPart(parts: Intl.DateTimeFormatPart[], partType: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === partType)?.value ?? "";
  return Number(value);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatGmailDate(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function clampHours(hours: number): number {
  const rounded = Math.trunc(hours);
  if (rounded < 1) {
    return 1;
  }
  if (rounded > 720) {
    return 720;
  }
  return rounded;
}

function extractRelativeHours(text: string): number | null {
  const direct = text.match(LAST_N_HOURS_PATTERN)?.[1];
  if (direct) {
    const parsed = Number(direct);
    if (Number.isFinite(parsed)) {
      return clampHours(parsed);
    }
  }

  // Handles phrasing like "deux dernières heures" or "2 hours"
  const altRaw = text.match(N_HOURS_ALT_PATTERN)?.[1];
  if (!altRaw) {
    return null;
  }
  const normalized = altRaw.toLowerCase();
  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) {
    return clampHours(parsed);
  }

  const wordsToHours: Record<string, number> = {
    one: 1,
    une: 1,
    un: 1,
    two: 2,
    deux: 2,
    three: 3,
    trois: 3,
    four: 4,
    quatre: 4,
    five: 5,
    cinq: 5,
    six: 6,
    seven: 7,
    sept: 7,
    eight: 8,
    huit: 8,
    nine: 9,
    neuf: 9,
    ten: 10,
    dix: 10
  };
  const wordValue = wordsToHours[normalized];
  return Number.isFinite(wordValue) ? clampHours(wordValue) : null;
}

export function normalizeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone || typeof timeZone !== "string") {
    return "UTC";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}
