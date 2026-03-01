export type RiskLevel = "low" | "medium" | "high" | "critical";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

export interface AgentIntent {
  name: string;
  confidence: number;
  entities: Record<string, string | number | boolean>;
}

export interface MessageDigest {
  id: string;
  connectorId: string;
  from: string;
  fromDomain?: string;
  subject: string;
  snippet: string;
  receivedAt: string;
}

export interface ImportanceScore {
  messageId: string;
  score: number;
  reasons: string[];
  category: "important" | "normal" | "bulk";
}

export interface ProposedReply {
  messageId: string;
  draft: string;
  tone: "formal" | "neutral" | "friendly";
  confidence: number;
}

export interface ActionProposal {
  id: string;
  connectorId: string;
  action: string;
  payload: Record<string, unknown>;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  requiresDoubleConfirmation?: boolean;
  readOnlyConnector?: boolean;
  createdAt: string;
}

export interface TimelineCard {
  id: string;
  type:
    | "fetch"
    | "analysis"
    | "proposal"
    | "sent"
    | "error"
    | "info"
    | "guardrail";
  title: string;
  body: string;
  source: string;
  timestamp: string;
  status: "pending" | "success" | "warning" | "error";
}

export interface GuardrailDecision {
  decision: "allow" | "deny" | "confirm" | "double_confirm";
  reason: string;
}

export interface ImportanceRules {
  vipSenders: string[];
  vipDomains: string[];
  keywords: string[];
  mutedDomains: string[];
}

export interface ConnectorDescriptor {
  id: string;
  name: string;
  category: string;
  supportsRead: boolean;
  supportsWrite: boolean;
  certifiedActions: string[];
}

export interface ConnectorView extends ConnectorDescriptor {
  connected: boolean;
  writeMode: "action-certified" | "read-only";
}

export interface AuditEvent {
  id: string;
  userId: string;
  type: string;
  actor: "agent" | "user" | "system";
  connectorId?: string;
  action?: string;
  status: "success" | "blocked" | "error" | "pending";
  detail: string;
  createdAt: string;
}

export interface SessionStartedEvent {
  sessionId: string;
  greeting: string;
}

export interface AudioUserChunkEvent {
  chunkBase64: string;
  commit?: boolean;
  sampleRate?: number;
}

export interface SttPartialEvent {
  text: string;
}

export interface SttFinalEvent {
  text: string;
}

export type SttStatusCode =
  | "warming_up"
  | "listening"
  | "partial_only_timeout"
  | "provider_error"
  | "mic_inactive";

export interface SttStatusEvent {
  code: SttStatusCode;
  message: string;
}

export interface AgentReplyPartialEvent {
  text: string;
}

export interface AgentReplyFinalEvent {
  text: string;
}

export interface ActionConfirmationRequiredEvent {
  actionProposal: ActionProposal;
  guardrail: GuardrailDecision;
}

export interface ActionExecutedEvent {
  actionId: string;
  connectorId: string;
  action: string;
  result: Record<string, unknown>;
}

export interface ActionBlockedEvent {
  actionId: string;
  reason: string;
}

export const WS_EVENTS = {
  SESSION_STARTED: "session.started",
  AUDIO_USER_CHUNK: "audio.user.chunk",
  STT_PARTIAL: "stt.partial",
  STT_FINAL: "stt.final",
  STT_STATUS: "stt.status",
  AGENT_REPLY_PARTIAL: "agent.reply.partial",
  AGENT_REPLY_FINAL: "agent.reply.final",
  TIMELINE_CARD_CREATED: "timeline.card.created",
  ACTION_PROPOSED: "action.proposed",
  ACTION_CONFIRMATION_REQUIRED: "action.confirmation.required",
  ACTION_CONFIRMED: "action.confirmed",
  ACTION_EXECUTED: "action.executed",
  ACTION_BLOCKED: "action.blocked",
  ERROR_RAISED: "error.raised",
  TTS_PREVIEW: "tts.preview",
  TTS_AUDIO: "tts.audio"
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];
