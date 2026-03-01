import { NotFoundException } from "@nestjs/common";

import { WS_EVENTS, type ActionProposal, type TimelineCard } from "@mark/contracts";

import { VoiceGateway } from "./voice.gateway";

function buildProposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "action-1",
    connectorId: "gmail",
    action: "email.reply",
    payload: {},
    riskLevel: "high",
    requiresConfirmation: true,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function buildTimelineCard(overrides: Partial<TimelineCard> = {}): TimelineCard {
  return {
    id: `card-${Date.now()}`,
    type: "guardrail",
    title: "Action blocked",
    body: "Blocked",
    source: "policy",
    timestamp: new Date().toISOString(),
    status: "warning",
    ...overrides
  };
}

describe("VoiceGateway", () => {
  let gateway: VoiceGateway;
  let client: { id: string; emit: jest.Mock; disconnect: jest.Mock };
  let speechmaticsAdapter: {
    startSession: jest.Mock;
    endSession: jest.Mock;
    getSession: jest.Mock;
    transcribeChunk: jest.Mock;
    isConfigured: jest.Mock;
  };
  let connectorsService: { executeAction: jest.Mock };
  let agentService: { processUtterance: jest.Mock };
  let policyService: { evaluateAction: jest.Mock };
  let timelineService: { addCard: jest.Mock };
  let auditService: { addEvent: jest.Mock };

  beforeEach(() => {
    speechmaticsAdapter = {
      startSession: jest.fn().mockResolvedValue({ on: jest.fn() }),
      endSession: jest.fn().mockResolvedValue(undefined),
      getSession: jest.fn(),
      transcribeChunk: jest.fn().mockReturnValue(null),
      isConfigured: jest.fn().mockReturnValue(false)
    };
    const elevenLabsAdapter = {
      synthesize: jest.fn().mockResolvedValue({
        streamId: "tts-1",
        audioChunks: [],
        contentType: "audio/mpeg"
      })
    };
    agentService = {
      processUtterance: jest.fn()
    };
    timelineService = {
      addCard: jest.fn((_: string, card: Omit<TimelineCard, "id" | "timestamp">) =>
        buildTimelineCard(card)
      )
    };
    policyService = {
      evaluateAction: jest.fn().mockReturnValue({
        decision: "confirm",
        reason: "Write action requires explicit confirmation"
      })
    };
    connectorsService = {
      executeAction: jest.fn()
    };
    auditService = {
      addEvent: jest.fn()
    };
    const authService = {
      verifyAccessToken: jest.fn()
    };

    gateway = new VoiceGateway(
      speechmaticsAdapter as any,
      elevenLabsAdapter as any,
      agentService as any,
      timelineService as any,
      policyService as any,
      connectorsService as any,
      auditService as any,
      authService as any
    );

    client = {
      id: "socket-1",
      emit: jest.fn(),
      disconnect: jest.fn()
    };

    (gateway as any).userByClientId.set(client.id, "user-1");
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not throw on expected execution failure and emits action.blocked", () => {
    connectorsService.executeAction.mockImplementation(() => {
      throw new NotFoundException("Connector gmail is not connected");
    });

    const pendingByUser = (gateway as any).pendingByUser as Map<string, Map<string, unknown>>;
    pendingByUser.set(
      "user-1",
      new Map([
        [
          "action-1",
          {
            proposal: buildProposal(),
            confirmations: 0,
            requiredConfirmations: 1
          }
        ]
      ])
    );

    expect(() => gateway.onActionConfirmed(client as any, { actionId: "action-1" })).not.toThrow();
    expect(client.emit).toHaveBeenCalledWith(
      WS_EVENTS.ACTION_BLOCKED,
      expect.objectContaining({ actionId: "action-1" })
    );
    expect(timelineService.addCard).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ type: "guardrail", status: "warning" })
    );
    expect((gateway as any).pendingByUser.get("user-1")?.has("action-1")).toBe(false);
  });

  it("emits error.raised and records an error audit event on unexpected execution failure", () => {
    connectorsService.executeAction.mockImplementation(() => {
      throw new Error("boom");
    });

    const pendingByUser = (gateway as any).pendingByUser as Map<string, Map<string, unknown>>;
    pendingByUser.set(
      "user-1",
      new Map([
        [
          "action-1",
          {
            proposal: buildProposal(),
            confirmations: 0,
            requiredConfirmations: 1
          }
        ]
      ])
    );

    expect(() => gateway.onActionConfirmed(client as any, { actionId: "action-1" })).not.toThrow();
    expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.ERROR_RAISED, {
      message: "Failed to execute action. Please try again."
    });
    expect(auditService.addEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "action.execution.error",
        status: "error"
      })
    );
    expect((gateway as any).pendingByUser.get("user-1")?.has("action-1")).toBe(false);
  });

  it("does not throw when allow-path action execution fails", () => {
    const proposal = buildProposal({
      action: "email.read",
      riskLevel: "low",
      requiresConfirmation: false
    });
    policyService.evaluateAction.mockReturnValue({
      decision: "allow",
      reason: "Read-only action allowed"
    });
    connectorsService.executeAction.mockImplementation(() => {
      throw new NotFoundException("Connector gmail is not connected");
    });

    expect(() => (gateway as any).handleProposal(client as any, "user-1", proposal)).not.toThrow();
    expect(client.emit).toHaveBeenCalledWith(
      WS_EVENTS.ACTION_BLOCKED,
      expect.objectContaining({ actionId: proposal.id })
    );
  });

  it("finalizes partial-only transcripts after timeout and processes agent reply", async () => {
    jest.useFakeTimers();
    speechmaticsAdapter.transcribeChunk.mockReturnValue("Hello from fallback");
    agentService.processUtterance.mockResolvedValue({
      timelineCards: [],
      actionProposals: [],
      reply: "Acknowledged."
    });

    gateway.onAudioChunk(client as any, { chunkBase64: "AAAA" });
    await jest.advanceTimersByTimeAsync(1600);

    expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.STT_FINAL, { text: "Hello from fallback" });
    expect(client.emit).toHaveBeenCalledWith(
      WS_EVENTS.STT_STATUS,
      expect.objectContaining({ code: "partial_only_timeout" })
    );
    expect(agentService.processUtterance).toHaveBeenCalledWith("user-1", "Hello from fallback");
  });

  it("does not use stub fallback while live STT is configured but still warming up", () => {
    speechmaticsAdapter.isConfigured.mockReturnValue(true);
    speechmaticsAdapter.getSession.mockReturnValue({
      canAcceptAudio: jest.fn().mockReturnValue(false),
      sendAudioChunk: jest.fn()
    });

    gateway.onAudioChunk(client as any, { chunkBase64: "AAAA" });

    expect(speechmaticsAdapter.transcribeChunk).not.toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalledWith(WS_EVENTS.STT_PARTIAL, expect.anything());
  });

  it("deduplicates repeated final transcripts", async () => {
    agentService.processUtterance.mockResolvedValue({
      timelineCards: [],
      actionProposals: [],
      reply: "Done."
    });

    await (gateway as any).processFinalTranscript(client as any, "Please archive this", "provider");
    await (gateway as any).processFinalTranscript(client as any, "Please archive this", "provider");

    expect(agentService.processUtterance).toHaveBeenCalledTimes(1);
  });

  it("aggregates closely spaced provider finals into one utterance", async () => {
    jest.useFakeTimers();
    agentService.processUtterance.mockResolvedValue({
      timelineCards: [],
      actionProposals: [],
      reply: "Done."
    });

    (gateway as any).handleProviderFinal(client as any, "Hello Mark");
    (gateway as any).handleProviderFinal(client as any, "can you hear me");

    await jest.advanceTimersByTimeAsync(600);
    await Promise.resolve();
    await Promise.resolve();

    expect(agentService.processUtterance).toHaveBeenCalledTimes(1);
    expect(agentService.processUtterance).toHaveBeenCalledWith("user-1", "Hello Mark can you hear me");
    expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.STT_FINAL, {
      text: "Hello Mark can you hear me"
    });
  });

  it("does not locally finalize on commit hints while live provider STT is active", async () => {
    const liveSession = {
      canAcceptAudio: jest.fn().mockReturnValue(true),
      sendAudioChunk: jest.fn()
    };
    speechmaticsAdapter.getSession.mockReturnValue(liveSession);
    agentService.processUtterance.mockResolvedValue({
      timelineCards: [],
      actionProposals: [],
      reply: "Done."
    });

    (gateway as any).handleSttPartial(client as any, "commit this");
    gateway.onAudioChunk(client as any, { chunkBase64: "AAAA", commit: true });
    await new Promise((resolve) => setImmediate(resolve));

    expect(liveSession.sendAudioChunk).toHaveBeenCalledWith(
      expect.objectContaining({ commit: true, sampleRate: 16000 })
    );
    expect(agentService.processUtterance).not.toHaveBeenCalledWith("user-1", "commit this");
  });

  it("applies commit hints in fallback mode when a recent partial exists", async () => {
    speechmaticsAdapter.getSession.mockReturnValue(undefined);
    speechmaticsAdapter.transcribeChunk.mockReturnValue("commit this");
    agentService.processUtterance.mockResolvedValue({
      timelineCards: [],
      actionProposals: [],
      reply: "Done."
    });

    gateway.onAudioChunk(client as any, { chunkBase64: "AAAA", commit: true });
    await new Promise((resolve) => setImmediate(resolve));

    expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.STT_FINAL, { text: "commit this" });
    expect(agentService.processUtterance).toHaveBeenCalledWith("user-1", "commit this");
  });

  it("emits provider diagnostics for STT errors", () => {
    (gateway as any).handleProviderSttError(client as any, new Error("unauthorized auth failure"));

    expect(client.emit).toHaveBeenCalledWith(
      WS_EVENTS.ERROR_RAISED,
      expect.objectContaining({ message: expect.stringContaining("auth_error") })
    );
    expect(client.emit).toHaveBeenCalledWith(
      WS_EVENTS.STT_STATUS,
      expect.objectContaining({ code: "provider_error" })
    );
  });

  it("maps common provider error categories", () => {
    expect((gateway as any).classifyProviderError(new Error("quota exceeded"))).toBe("quota_exceeded");
    expect((gateway as any).classifyProviderError(new Error("input_error invalid format"))).toBe("input_error");
    expect((gateway as any).classifyProviderError(new Error("insufficient_audio_activity"))).toBe(
      "insufficient_audio_activity"
    );
  });
});
