import { Logger, NotFoundException, type OnModuleInit } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

import {
  WS_EVENTS,
  type AudioUserChunkEvent,
  type ActionConfirmationRequiredEvent,
  type ActionProposal,
  type SttFinalEvent,
  type SttPartialEvent,
  type SttStatusEvent
} from "@mark/contracts";

import { isApiDebugLoggingEnabled } from "@/common/debug-logging";
import { getSocketBearerToken } from "@/common/socket-user-id";
import { AgentService } from "@/modules/agent/agent.service";
import { AuditService } from "@/modules/audit/audit.service";
import { AuthService } from "@/modules/auth/auth.service";
import { ConnectorsService } from "@/modules/connectors/connectors.service";
import { PolicyService } from "@/modules/policy/policy.service";
import { TimelineService } from "@/modules/timeline/timeline.service";

import { ElevenLabsAdapter } from "./elevenlabs.adapter";
import { SpeechmaticsAdapter } from "./speechmatics.adapter";

interface PendingAction {
  proposal: ActionProposal;
  confirmations: number;
  requiredConfirmations: number;
}

interface SttTrackingState {
  lastPartialText: string;
  lastPartialAtMs: number;
  lastCommittedTextHash: string;
  fallbackFinalizer: ReturnType<typeof setTimeout> | null;
  providerFinalizer: ReturnType<typeof setTimeout> | null;
  providerFinalBuffer: string;
  hasEmittedListeningStatus: boolean;
  audioChunkCount: number;
}

type FinalSource = "provider" | "client" | "fallback_partial_commit" | "client_commit_hint";

const STT_PARTIAL_FINALIZER_MS = 1500;
const STT_PROVIDER_FINAL_AGGREGATION_MS = 500;
const STT_COMMIT_HINT_MAX_AGE_MS = 2500;
const DEFAULT_AUDIO_SAMPLE_RATE = 16000;

@WebSocketGateway({
  namespace: "/v1/session",
  cors: {
    origin: "*"
  }
})
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(VoiceGateway.name);
  private readonly pendingByUser = new Map<string, Map<string, PendingAction>>();
  private readonly userByClientId = new Map<string, string>();
  private readonly sttTrackingByClientId = new Map<string, SttTrackingState>();
  private readonly debugLogsEnabled = isApiDebugLoggingEnabled();

  constructor(
    private readonly speechmaticsAdapter: SpeechmaticsAdapter,
    private readonly elevenLabsAdapter: ElevenLabsAdapter,
    private readonly agentService: AgentService,
    private readonly timelineService: TimelineService,
    private readonly policyService: PolicyService,
    private readonly connectorsService: ConnectorsService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService
  ) {}

  onModuleInit(): void {
    // Register Socket.IO auth middleware
    this.server.use((socket: Socket, next: (err?: Error) => void) => {
      const token = getSocketBearerToken(socket);
      if (!token) {
        return next(new Error("Missing bearer token for session"));
      }

      try {
        const claims = this.authService.verifyAccessToken(token);
        (socket.data as { userId: string }).userId = claims.userId;
        next();
      } catch {
        next(new Error("Invalid bearer token for session"));
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const userId = (client.data as { userId?: string }).userId;
    if (!userId) {
      client.disconnect(true);
      return;
    }

    this.userByClientId.set(client.id, userId);
    this.sttTrackingByClientId.set(client.id, this.createSttTrackingState());
    this.debugTrace("session.connected", {
      clientId: client.id,
      userId
    });
    this.emitSttStatus(client, {
      code: "warming_up",
      message: "Preparing speech recognition."
    });

    // Start Speechmatics STT session
    try {
      const sttSession = await this.speechmaticsAdapter.startSession(client.id);
      this.debugTrace("stt.session.started", {
        clientId: client.id,
        mode: this.speechmaticsAdapter.getMode()
      });
      sttSession.on("partial", (text: string) => {
        this.handleSttPartial(client, text);
      });
      sttSession.on("final", (text: string) => {
        this.handleProviderFinal(client, text);
      });
      sttSession.on("error", (err: Error) => {
        this.logger.error(`STT error for session ${client.id}`, err.message);
        this.handleProviderSttError(client, err);
      });
    } catch (err) {
      this.logger.error(`Failed to start STT session ${client.id}`, err);
      this.handleProviderSttError(client, err);
    }

    const greeting = "What do you want to start with?";
    client.emit(WS_EVENTS.SESSION_STARTED, {
      sessionId: client.id,
      greeting
    });

    this.auditService.addEvent({
      userId,
      type: "session.started",
      actor: "system",
      status: "success",
      detail: `Voice session started (${client.id})`
    });
    this.emitSttStatus(client, {
      code: "listening",
      message: "Listening for your request."
    });
    const tracking = this.ensureSttTracking(client.id);
    tracking.hasEmittedListeningStatus = true;

    this.emitAgentReply(client, greeting);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = this.userByClientId.get(client.id);
    if (userId) {
      this.pendingByUser.delete(userId);
    }
    const tracking = this.sttTrackingByClientId.get(client.id);
    if (tracking?.fallbackFinalizer) {
      clearTimeout(tracking.fallbackFinalizer);
    }
    if (tracking?.providerFinalizer) {
      clearTimeout(tracking.providerFinalizer);
    }
    this.userByClientId.delete(client.id);
    this.sttTrackingByClientId.delete(client.id);
    this.debugTrace("session.disconnected", {
      clientId: client.id,
      userId: userId ?? "unknown"
    });

    // End Speechmatics STT session
    await this.speechmaticsAdapter.endSession(client.id).catch((err) => {
      this.logger.error(`Failed to end STT session ${client.id}`, err);
    });
  }

  @SubscribeMessage(WS_EVENTS.AUDIO_USER_CHUNK)
  onAudioChunk(@ConnectedSocket() client: Socket, @MessageBody() payload: AudioUserChunkEvent): void {
    if (!this.mustGetUserId(client)) {
      return;
    }
    const tracking = this.ensureSttTracking(client.id);
    tracking.audioChunkCount += 1;
    if (payload.commit || tracking.audioChunkCount % 20 === 0) {
      this.debugTrace("audio.chunk.received", {
        clientId: client.id,
        chunkCount: tracking.audioChunkCount,
        bytes: payload.chunkBase64.length,
        commit: payload.commit ?? false,
        sampleRate: payload.sampleRate ?? DEFAULT_AUDIO_SAMPLE_RATE
      });
    }

    // Try real Speechmatics session first
    const sttSession = this.speechmaticsAdapter.getSession(client.id);
    if (sttSession?.canAcceptAudio()) {
      sttSession.sendAudioChunk({
        chunkBase64: payload.chunkBase64,
        commit: payload.commit,
        sampleRate: payload.sampleRate ?? DEFAULT_AUDIO_SAMPLE_RATE
      });
      this.emitListeningStatusOnce(client);

      if (payload.commit) {
        this.debugTrace("audio.chunk.commit_hint", {
          clientId: client.id,
          chunkCount: tracking.audioChunkCount
        });
      }
      return;
    }

    // In live provider mode, avoid emitting stub transcripts while the upstream
    // realtime session is still warming up.
    if (this.speechmaticsAdapter.isConfigured()) {
      return;
    }

    // Fallback to stub
    const partial = this.speechmaticsAdapter.transcribeChunk(payload.chunkBase64);
    if (partial) {
      this.handleSttPartial(client, partial);
    }

    if (payload.commit) {
      this.debugTrace("audio.chunk.commit_hint_fallback", {
        clientId: client.id,
        chunkCount: tracking.audioChunkCount
      });
      void this.tryProcessClientCommitHint(client);
    }
  }

  @SubscribeMessage(WS_EVENTS.STT_FINAL)
  async onSttFinal(@ConnectedSocket() client: Socket, @MessageBody() payload: SttFinalEvent): Promise<void> {
    await this.processFinalTranscript(client, payload.text, "client");
  }

  private async processFinalTranscript(
    client: Socket,
    rawText: string,
    source: FinalSource
  ): Promise<void> {
    const userId = this.mustGetUserId(client);
    if (!userId) {
      return;
    }

    const text = rawText.trim();
    if (!text) {
      return;
    }

    const tracking = this.ensureSttTracking(client.id);
    const finalHash = this.hashText(text);
    if (tracking.lastCommittedTextHash === finalHash) {
      this.debugTrace("stt.final.deduped", {
        clientId: client.id,
        source,
        hash: finalHash
      });
      return;
    }

    tracking.lastCommittedTextHash = finalHash;
    tracking.lastPartialText = text;
    tracking.lastPartialAtMs = Date.now();
    if (tracking.fallbackFinalizer) {
      clearTimeout(tracking.fallbackFinalizer);
      tracking.fallbackFinalizer = null;
    }
    if (tracking.providerFinalizer) {
      clearTimeout(tracking.providerFinalizer);
      tracking.providerFinalizer = null;
    }
    tracking.providerFinalBuffer = "";

    client.emit(WS_EVENTS.STT_FINAL, { text } satisfies SttFinalEvent);
    if (source === "fallback_partial_commit") {
      this.emitSttStatus(client, {
        code: "partial_only_timeout",
        message: "Captured speech with backup finalization. Continuing conversation."
      });
    }
    this.debugTrace("stt.final.processed", {
      clientId: client.id,
      source,
      textPreview: this.previewText(text),
      textLength: text.length
    });

    try {
      this.auditService.addEvent({
        userId,
        type: "stt.final",
        actor: "user",
        status: "success",
        detail: text
      });

      const result = await this.agentService.processUtterance(userId, text);
      this.debugTrace("agent.reply.ready", {
        clientId: client.id,
        timelineCards: result.timelineCards.length,
        actionProposals: result.actionProposals.length,
        replyLength: result.reply.length
      });
      for (const rawCard of result.timelineCards) {
        const card = this.timelineService.addCard(userId, {
          type: rawCard.type,
          title: rawCard.title,
          body: rawCard.body,
          source: rawCard.source,
          status: rawCard.status
        });
        client.emit(WS_EVENTS.TIMELINE_CARD_CREATED, card);
      }

      for (const proposal of result.actionProposals) {
        this.handleProposal(client, userId, proposal);
      }

      this.emitAgentReply(client, result.reply);
    } catch (err) {
      this.logger.error("Error processing STT final", err);
      client.emit(WS_EVENTS.ERROR_RAISED, { message: "Failed to process your request. Please try again." });
    }
  }

  @SubscribeMessage(WS_EVENTS.ACTION_CONFIRMED)
  onActionConfirmed(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { actionId: string; spokenConfirmation?: string }
  ): void {
    const userId = this.mustGetUserId(client);
    if (!userId) {
      return;
    }

    const pending = this.pendingByUser.get(userId)?.get(payload.actionId);
    if (!pending) {
      client.emit(WS_EVENTS.ERROR_RAISED, { message: "Unknown action confirmation" });
      return;
    }

    pending.confirmations += 1;
    this.auditService.addEvent({
      userId,
      type: "action.confirmed",
      actor: "user",
      connectorId: pending.proposal.connectorId,
      action: pending.proposal.action,
      status: "success",
      detail: `Confirmation ${pending.confirmations}/${pending.requiredConfirmations}`
    });

    if (pending.confirmations < pending.requiredConfirmations) {
      this.emitAgentReply(client, "Second confirmation required for sensitive action. Please confirm again.");
      return;
    }

    try {
      const result = this.connectorsService.executeAction(userId, pending.proposal);
      this.pendingByUser.get(userId)?.delete(payload.actionId);

      client.emit(WS_EVENTS.ACTION_EXECUTED, {
        actionId: payload.actionId,
        connectorId: pending.proposal.connectorId,
        action: pending.proposal.action,
        result
      });

      const card = this.timelineService.addCard(userId, {
        type: "sent",
        title: "Action executed",
        body: `${pending.proposal.action} completed on ${pending.proposal.connectorId}.`,
        source: pending.proposal.connectorId,
        status: "success"
      });
      client.emit(WS_EVENTS.TIMELINE_CARD_CREATED, card);
    } catch (err) {
      this.pendingByUser.get(userId)?.delete(payload.actionId);
      this.handleActionExecutionFailure(client, userId, pending.proposal, payload.actionId, err);
    }
  }

  private handleProposal(client: Socket, userId: string, proposal: ActionProposal): void {
    const decision = this.policyService.evaluateAction(userId, proposal);
    this.debugTrace("action.proposal.evaluated", {
      clientId: client.id,
      userId,
      actionId: proposal.id,
      connectorId: proposal.connectorId,
      action: proposal.action,
      decision: decision.decision
    });
    if (decision.decision === "deny") {
      this.auditService.addEvent({
        userId,
        type: "action.blocked",
        actor: "system",
        connectorId: proposal.connectorId,
        action: proposal.action,
        status: "blocked",
        detail: decision.reason
      });

      client.emit(WS_EVENTS.ACTION_BLOCKED, {
        actionId: proposal.id,
        reason: decision.reason
      });

      const card = this.timelineService.addCard(userId, {
        type: "guardrail",
        title: "Action blocked",
        body: decision.reason,
        source: "policy",
        status: "warning"
      });
      client.emit(WS_EVENTS.TIMELINE_CARD_CREATED, card);
      return;
    }

    if (decision.decision === "allow") {
      try {
        const result = this.connectorsService.executeAction(userId, proposal);
        client.emit(WS_EVENTS.ACTION_EXECUTED, {
          actionId: proposal.id,
          connectorId: proposal.connectorId,
          action: proposal.action,
          result
        });
      } catch (err) {
        this.handleActionExecutionFailure(client, userId, proposal, proposal.id, err);
      }
      return;
    }

    const requiredConfirmations = decision.decision === "double_confirm" ? 2 : 1;
    const byUser = this.pendingByUser.get(userId) ?? new Map<string, PendingAction>();
    byUser.set(proposal.id, {
      proposal,
      confirmations: 0,
      requiredConfirmations
    });
    this.pendingByUser.set(userId, byUser);

    client.emit(WS_EVENTS.ACTION_PROPOSED, proposal);
    const event: ActionConfirmationRequiredEvent = {
      actionProposal: proposal,
      guardrail: decision
    };
    client.emit(WS_EVENTS.ACTION_CONFIRMATION_REQUIRED, event);

    const card = this.timelineService.addCard(userId, {
      type: "proposal",
      title: "Confirmation required",
      body: `${proposal.action} on ${proposal.connectorId}: ${decision.reason}`,
      source: "policy",
      status: "pending"
    });
    client.emit(WS_EVENTS.TIMELINE_CARD_CREATED, card);
  }

  private async emitAgentReply(client: Socket, text: string): Promise<void> {
    const firstSentence = text.split(".")[0]?.trim();
    if (firstSentence) {
      client.emit(WS_EVENTS.AGENT_REPLY_PARTIAL, { text: firstSentence });
    }

    client.emit(WS_EVENTS.AGENT_REPLY_FINAL, { text });
    this.debugTrace("agent.reply.emitted", {
      clientId: client.id,
      textPreview: this.previewText(text),
      textLength: text.length
    });

    // Synthesize and stream TTS audio
    try {
      const result = await this.elevenLabsAdapter.synthesize(text);
      this.debugTrace("tts.synthesis.completed", {
        clientId: client.id,
        streamId: result.streamId,
        chunks: result.audioChunks.length,
        contentType: result.contentType
      });
      for (const chunk of result.audioChunks) {
        client.emit(WS_EVENTS.TTS_AUDIO, {
          streamId: result.streamId,
          chunkBase64: chunk.toString("base64"),
          contentType: result.contentType,
        });
      }
    } catch (err) {
      this.logger.error("TTS synthesis failed", err);
    }
  }

  private handleActionExecutionFailure(
    client: Socket,
    userId: string,
    proposal: ActionProposal,
    actionId: string,
    err: unknown
  ): void {
    const reason = this.getErrorMessage(err);
    if (this.isExpectedActionFailure(err)) {
      this.auditService.addEvent({
        userId,
        type: "action.blocked",
        actor: "system",
        connectorId: proposal.connectorId,
        action: proposal.action,
        status: "blocked",
        detail: reason
      });

      client.emit(WS_EVENTS.ACTION_BLOCKED, {
        actionId,
        reason
      });

      const card = this.timelineService.addCard(userId, {
        type: "guardrail",
        title: "Action blocked",
        body: reason,
        source: "policy",
        status: "warning"
      });
      client.emit(WS_EVENTS.TIMELINE_CARD_CREATED, card);
      return;
    }

    this.logger.error("Action execution failed", err);
    this.auditService.addEvent({
      userId,
      type: "action.execution.error",
      actor: "system",
      connectorId: proposal.connectorId,
      action: proposal.action,
      status: "error",
      detail: reason
    });
    client.emit(WS_EVENTS.ERROR_RAISED, { message: "Failed to execute action. Please try again." });
  }

  private isExpectedActionFailure(err: unknown): boolean {
    if (err instanceof NotFoundException) {
      return true;
    }

    if (
      typeof err === "object" &&
      err !== null &&
      "getStatus" in err &&
      typeof (err as { getStatus: () => number }).getStatus === "function"
    ) {
      return (err as { getStatus: () => number }).getStatus() === 404;
    }

    return false;
  }

  private getErrorMessage(err: unknown): string {
    if (err instanceof Error && err.message) {
      return err.message;
    }
    return "Action execution failed";
  }

  private mustGetUserId(client: Socket): string | null {
    const userId = this.userByClientId.get(client.id);
    if (!userId) {
      client.emit(WS_EVENTS.ERROR_RAISED, { message: "Unauthenticated session" });
      client.disconnect(true);
      return null;
    }
    return userId;
  }

  private handleSttPartial(client: Socket, rawText: string): void {
    const text = rawText.trim();
    if (!text) {
      return;
    }

    const tracking = this.ensureSttTracking(client.id);
    tracking.lastPartialText = text;
    tracking.lastPartialAtMs = Date.now();

    const event: SttPartialEvent = { text };
    client.emit(WS_EVENTS.STT_PARTIAL, event);
    this.debugTrace("stt.partial.received", {
      clientId: client.id,
      textPreview: this.previewText(text),
      textLength: text.length
    });
    this.emitListeningStatusOnce(client);
    this.scheduleFallbackFinalizer(client);
  }

  private handleProviderFinal(client: Socket, rawText: string): void {
    const text = rawText.trim();
    if (!text) {
      return;
    }

    const tracking = this.ensureSttTracking(client.id);
    tracking.providerFinalBuffer = this.mergeProviderFinalBuffer(tracking.providerFinalBuffer, text);
    this.debugTrace("stt.provider_final.buffered", {
      clientId: client.id,
      textPreview: this.previewText(text),
      bufferedPreview: this.previewText(tracking.providerFinalBuffer)
    });

    if (tracking.providerFinalizer) {
      clearTimeout(tracking.providerFinalizer);
    }

    tracking.providerFinalizer = setTimeout(() => {
      const latest = this.sttTrackingByClientId.get(client.id);
      const buffered = latest?.providerFinalBuffer.trim() ?? "";
      if (!latest || !buffered) {
        return;
      }

      latest.providerFinalBuffer = "";
      latest.providerFinalizer = null;
      this.debugTrace("stt.provider_final.flushed", {
        clientId: client.id,
        textPreview: this.previewText(buffered)
      });
      void this.processFinalTranscript(client, buffered, "provider");
    }, STT_PROVIDER_FINAL_AGGREGATION_MS);
  }

  private scheduleFallbackFinalizer(client: Socket): void {
    const tracking = this.ensureSttTracking(client.id);
    if (tracking.fallbackFinalizer) {
      clearTimeout(tracking.fallbackFinalizer);
    }

    tracking.fallbackFinalizer = setTimeout(() => {
      const latest = this.sttTrackingByClientId.get(client.id);
      if (!latest?.lastPartialText) {
        return;
      }

      const elapsed = Date.now() - latest.lastPartialAtMs;
      if (elapsed < STT_PARTIAL_FINALIZER_MS - 25) {
        return;
      }

      this.debugTrace("stt.fallback_finalizer.fired", {
        clientId: client.id,
        elapsedMs: elapsed,
        textPreview: this.previewText(latest.lastPartialText)
      });
      void this.processFinalTranscript(client, latest.lastPartialText, "fallback_partial_commit");
    }, STT_PARTIAL_FINALIZER_MS);
  }

  private async tryProcessClientCommitHint(client: Socket): Promise<void> {
    const tracking = this.ensureSttTracking(client.id);
    const text = tracking.lastPartialText.trim();
    if (!text) {
      return;
    }

    const ageMs = Date.now() - tracking.lastPartialAtMs;
    if (ageMs > STT_COMMIT_HINT_MAX_AGE_MS) {
      this.debugTrace("stt.commit_hint.skipped", {
        clientId: client.id,
        reason: "partial_too_old",
        ageMs
      });
      return;
    }

    this.debugTrace("stt.commit_hint.applied", {
      clientId: client.id,
      ageMs,
      textPreview: this.previewText(text)
    });
    await this.processFinalTranscript(client, text, "client_commit_hint");
  }

  private handleProviderSttError(client: Socket, err: unknown): void {
    const providerCode = this.classifyProviderError(err);
    const detail = providerCode ? ` (${providerCode})` : "";
    const message = `Speech transcription failed${detail}.`;

    client.emit(WS_EVENTS.ERROR_RAISED, { message });
    this.emitSttStatus(client, {
      code: "provider_error",
      message
    });
  }

  private classifyProviderError(err: unknown): string {
    const lower = this.getErrorMessage(err).toLowerCase();
    if (!lower) {
      return "unknown_error";
    }
    if (
      lower.includes("auth") ||
      lower.includes("unauthor") ||
      lower.includes("forbidden") ||
      lower.includes("invalid token")
    ) {
      return "auth_error";
    }
    if (
      lower.includes("quota") ||
      lower.includes("rate limit") ||
      lower.includes("rate_limit") ||
      lower.includes("too_many_requests")
    ) {
      return "quota_exceeded";
    }
    if (
      lower.includes("input_error") ||
      lower.includes("input") ||
      lower.includes("format") ||
      lower.includes("malformed")
    ) {
      return "input_error";
    }
    if (lower.includes("insufficient_audio_activity")) {
      return "insufficient_audio_activity";
    }
    if (lower.includes("terms")) {
      return "unaccepted_terms";
    }
    return "provider_error";
  }

  private emitListeningStatusOnce(client: Socket): void {
    const tracking = this.ensureSttTracking(client.id);
    if (tracking.hasEmittedListeningStatus) {
      return;
    }
    tracking.hasEmittedListeningStatus = true;
    this.emitSttStatus(client, {
      code: "listening",
      message: "Listening for your request."
    });
  }

  private emitSttStatus(client: Socket, payload: SttStatusEvent): void {
    client.emit(WS_EVENTS.STT_STATUS, payload);
    this.debugTrace("stt.status.emitted", {
      clientId: client.id,
      code: payload.code,
      message: payload.message
    });
  }

  private createSttTrackingState(): SttTrackingState {
    return {
      lastPartialText: "",
      lastPartialAtMs: 0,
      lastCommittedTextHash: "",
      fallbackFinalizer: null,
      providerFinalizer: null,
      providerFinalBuffer: "",
      hasEmittedListeningStatus: false,
      audioChunkCount: 0
    };
  }

  private ensureSttTracking(clientId: string): SttTrackingState {
    const existing = this.sttTrackingByClientId.get(clientId);
    if (existing) {
      return existing;
    }

    const created = this.createSttTrackingState();
    this.sttTrackingByClientId.set(clientId, created);
    return created;
  }

  private hashText(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }

  private previewText(value: string): string {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length <= 80) {
      return normalized;
    }
    return `${normalized.slice(0, 77)}...`;
  }

  private mergeProviderFinalBuffer(existing: string, incoming: string): string {
    const next = incoming.trim();
    if (!existing.trim()) {
      return next;
    }

    const current = existing.trim();
    const currentHash = this.hashText(current);
    const nextHash = this.hashText(next);

    if (!nextHash) {
      return current;
    }
    if (currentHash === nextHash || currentHash.endsWith(nextHash)) {
      return current;
    }
    if (nextHash.startsWith(currentHash)) {
      return next;
    }

    return `${current} ${next}`.replace(/\s+/g, " ").trim();
  }

  private debugTrace(event: string, payload: Record<string, unknown>): void {
    if (!this.debugLogsEnabled) {
      return;
    }
    this.logger.debug(`[debug] ${event} ${JSON.stringify(payload)}`);
  }
}
