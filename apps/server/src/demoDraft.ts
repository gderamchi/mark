type DemoEmailInput = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
};

type BuildDemoDraftParams = {
  email: DemoEmailInput;
  instruction: string;
};

const FIRST_NAMES = [
  "Alex",
  "Jordan",
  "Taylor",
  "Morgan",
  "Casey",
  "Sam",
  "Riley",
  "Jamie"
];

export function buildDemoFictionalReplyDraft(params: BuildDemoDraftParams): string {
  const seed = hashSeed(`${params.email.id}|${params.email.subject}|${params.instruction}`);
  const fromName = pickFirstName(params.email.from, seed);

  const baselineUsers = 3_800 + (seed % 3_400);
  const growthUsers = 700 + ((seed >> 2) % 2_300);
  const finalUsers = baselineUsers + growthUsers;
  const growthPercent = Math.round((growthUsers / baselineUsers) * 100);

  const conversionBefore = 8 + (seed % 7);
  const conversionAfter = conversionBefore + 4 + ((seed >> 3) % 6);

  const responseBeforeHours = 28 + (seed % 19);
  const responseAfterHours = Math.max(6, responseBeforeHours - (8 + ((seed >> 1) % 12)));

  const pipelineMrr = 24_000 + (seed % 42_000);
  const winRate = 22 + (seed % 17);

  const contextHint = compactText(params.email.snippet, 100);
  const customInstruction = compactText(params.instruction, 120);
  const includeInstruction = customInstruction.length > 0 && !/^create the first draft\.?$/i.test(customInstruction);

  const lines = [
    `Hi ${fromName},`,
    "",
    `Thanks for your note about "${compactText(params.email.subject, 90)}".`,
    `For context, our recent pilot moved weekly active usage from ${formatInt(baselineUsers)} to ${formatInt(finalUsers)} (+${growthPercent}%),`,
    `improved conversion from ${conversionBefore}% to ${conversionAfter}%, and reduced response time from ${responseBeforeHours}h to ${responseAfterHours}h.`,
    `We are currently tracking ${formatCurrency(pipelineMrr)} in qualified pipeline with a ${winRate}% close rate on similar opportunities.`
  ];

  if (contextHint.length > 0) {
    lines.push(`Your point on "${contextHint}" fits well with this direction.`);
  }

  if (includeInstruction) {
    lines.push(`Following your request, we can tailor the next step to: ${customInstruction}.`);
  }

  lines.push("If this works for you, I can share the full rollout plan and proposed timeline today.");
  lines.push("");
  lines.push("Best,");
  lines.push("Mark Team");

  return lines.join("\n");
}

function pickFirstName(fromValue: string, seed: number): string {
  const explicitName = fromValue
    .replace(/<[^>]+>/g, " ")
    .replace(/["']/g, "")
    .split(/\s+/)
    .map((part) => part.trim())
    .find((part) => /^[A-Za-z][A-Za-z-]{1,24}$/.test(part));

  if (explicitName) {
    return explicitName;
  }
  return FIRST_NAMES[seed % FIRST_NAMES.length] ?? "there";
}

function hashSeed(input: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) || 1;
}

function compactText(value: string, maxChars: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxChars) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, maxChars - 15))}...(truncated)`;
}

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}
