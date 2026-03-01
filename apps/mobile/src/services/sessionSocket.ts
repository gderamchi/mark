import { io, type Socket } from "socket.io-client";

import {
  WS_EVENTS,
  type AudioUserChunkEvent,
  type ActionBlockedEvent,
  type ActionProposal,
  type SessionStartedEvent,
  type SttStatusCode,
  type SttStatusEvent,
  type TimelineCard
} from "@mark/contracts";

import { apiClient } from "./apiClient";
import { debugLog } from "./debugLogger";
import { useAppStore } from "../store/useAppStore";
import { getSocketBaseUrl } from "./runtimeConfig";
import { playTtsAudio } from "./ttsPlayer";

const API_BASE_URL = getSocketBaseUrl();
const AUTH_RETRY_LIMIT = 4;
const BASE_RECONNECT_DELAY_MS = 800;
const MAX_RECONNECT_DELAY_MS = 8000;

class SessionSocket {
  private socket: Socket | null = null;
  private ttsFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sttStatusResetTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private refreshingAuth = false;
  private manuallyDisconnected = false;
  private audioChunkCount = 0;

  connect(): void {
    if (this.socket?.connected) return;
    this.manuallyDisconnected = false;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    const { accessToken } = useAppStore.getState();
    if (!accessToken) {
      debugLog("ws", "connect.skipped_missing_token");
      return;
    }

    this.socket = io(`${API_BASE_URL}/v1/session`, {
      transports: ["websocket"],
      auth: {
        token: accessToken
      },
      reconnection: false,
      extraHeaders: {
        authorization: `Bearer ${accessToken}`
      }
    });
    debugLog("ws", "connect.start", {
      baseUrl: API_BASE_URL,
      namespace: "/v1/session"
    });
    this.setLocalSttStatus("warming_up", "Connecting voice session...");

    this.registerHandlers();
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    this.clearReconnectTimer();
    this.clearSttStatusResetTimer();
    if (this.ttsFallbackTimer) {
      clearTimeout(this.ttsFallbackTimer);
      this.ttsFallbackTimer = null;
    }
    this.socket?.disconnect();
    this.socket = null;
    this.audioChunkCount = 0;
    debugLog("ws", "disconnect.manual");
    useAppStore.getState().setSessionConnected(false);
    useAppStore.getState().setVoiceState("idle");
    useAppStore.getState().setSttStatus(null);
  }

  sendTranscript(text: string): void {
    debugLog("ws", "send.stt_final", { textLength: text.length });
    this.socket?.emit(WS_EVENTS.STT_FINAL, { text });
  }

  sendAudioChunk(chunkBase64: string, options?: { commit?: boolean; sampleRate?: number }): void {
    const payload: AudioUserChunkEvent = {
      chunkBase64,
      ...(typeof options?.commit === "boolean" ? { commit: options.commit } : {}),
      ...(typeof options?.sampleRate === "number" ? { sampleRate: options.sampleRate } : {})
    };
    this.audioChunkCount += 1;
    if (payload.commit || this.audioChunkCount % 20 === 0) {
      debugLog("ws", "send.audio_chunk", {
        chunkCount: this.audioChunkCount,
        bytes: chunkBase64.length,
        commit: payload.commit ?? false,
        sampleRate: payload.sampleRate ?? null
      });
    }
    this.socket?.emit(WS_EVENTS.AUDIO_USER_CHUNK, payload);
  }

  confirmAction(actionId: string): void {
    debugLog("ws", "send.action_confirmed", { actionId });
    this.socket?.emit(WS_EVENTS.ACTION_CONFIRMED, { actionId });
  }

  setLocalSttStatus(code: SttStatusCode, message: string): void {
    useAppStore.getState().setSttStatus({ code, message });
  }

  private registerHandlers(): void {
    if (!this.socket) {
      return;
    }

    this.socket.on("connect", () => {
      this.clearReconnectTimer();
      this.reconnectAttempts = 0;
      debugLog("ws", "connect.success");
      useAppStore.getState().setSttPartial("");
      useAppStore.getState().setVoiceState("listening");
    });

    this.socket.on("connect_error", (err: Error) => {
      debugLog("ws", "connect.error", err);
      void this.handleConnectError(err);
    });

    this.socket.on("disconnect", (reason: string) => {
      debugLog("ws", "disconnect", { reason, manuallyDisconnected: this.manuallyDisconnected });
      if (this.manuallyDisconnected) {
        useAppStore.getState().setSessionConnected(false);
        useAppStore.getState().setVoiceState("idle");
        return;
      }
      useAppStore.getState().setSessionConnected(false);
      useAppStore.getState().setVoiceState("idle");
      this.setLocalSttStatus("warming_up", "Voice session disconnected. Reconnecting...");
      this.scheduleReconnect(`socket disconnected: ${reason}`);
    });

    this.socket.on(WS_EVENTS.STT_STATUS, (payload: SttStatusEvent) => {
      debugLog("ws", "event.stt_status", payload);
      useAppStore.getState().setSttStatus(payload);
      if (payload.code === "partial_only_timeout") {
        this.scheduleListeningStatusReset();
      } else {
        this.clearSttStatusResetTimer();
      }
    });

    this.socket.on(WS_EVENTS.SESSION_STARTED, (_payload: SessionStartedEvent) => {
      debugLog("ws", "event.session_started");
      useAppStore.getState().setSessionConnected(true);
      this.setLocalSttStatus("listening", "Listening for your request.");
    });

    this.socket.on(WS_EVENTS.ACTION_BLOCKED, (payload: ActionBlockedEvent) => {
      debugLog("ws", "event.action_blocked", payload);
      useAppStore.getState().removePendingAction(payload.actionId);
      const card: TimelineCard = {
        id: `blocked-${Date.now()}`,
        type: "guardrail",
        title: "Action blocked",
        body: payload.reason,
        source: "policy",
        timestamp: new Date().toISOString(),
        status: "warning"
      };
      useAppStore.getState().pushTimelineCard(card);
    });

    this.socket.on(WS_EVENTS.STT_PARTIAL, (payload: { text: string }) => {
      debugLog("ws", "event.stt_partial", { textLength: payload.text.length });
      useAppStore.getState().setVoiceState("listening");
      useAppStore.getState().setSttPartial(payload.text);
      this.setLocalSttStatus("listening", "Listening for your request.");
    });

    this.socket.on(WS_EVENTS.STT_FINAL, (payload: { text: string }) => {
      debugLog("ws", "event.stt_final", { textLength: payload.text.length });
      useAppStore.getState().setSttPartial(payload.text);
      useAppStore.getState().setVoiceState("thinking");
    });

    this.socket.on(WS_EVENTS.AGENT_REPLY_PARTIAL, (payload: { text: string }) => {
      debugLog("ws", "event.agent_reply_partial", { textLength: payload.text.length });
      useAppStore.getState().setVoiceState("speaking");
      useAppStore.getState().setLatestReply(payload.text);
    });

    this.socket.on(WS_EVENTS.AGENT_REPLY_FINAL, (payload: { text: string }) => {
      debugLog("ws", "event.agent_reply_final", { textLength: payload.text.length });
      useAppStore.getState().setLatestReply(payload.text);
      if (this.ttsFallbackTimer) {
        clearTimeout(this.ttsFallbackTimer);
      }
      // Fallback: if no TTS audio arrives within 5s, go back to listening
      this.ttsFallbackTimer = setTimeout(() => {
        if (useAppStore.getState().voiceState === "speaking") {
          useAppStore.getState().setVoiceState("listening");
        }
      }, 5000);
    });

    this.socket.on(WS_EVENTS.TTS_AUDIO, (payload: { streamId: string; chunkBase64: string; contentType: string }) => {
      debugLog("ws", "event.tts_audio", {
        streamId: payload.streamId,
        bytes: payload.chunkBase64.length,
        contentType: payload.contentType
      });
      if (this.ttsFallbackTimer) {
        clearTimeout(this.ttsFallbackTimer);
        this.ttsFallbackTimer = null;
      }
      useAppStore.getState().setVoiceState("speaking");
      void playTtsAudio(payload.chunkBase64)
        .catch(() => {
          const card: TimelineCard = {
            id: `err-${Date.now()}`,
            type: "error",
            title: "Audio playback error",
            body: "Failed to play synthesized speech.",
            source: "session",
            timestamp: new Date().toISOString(),
            status: "error"
          };
          useAppStore.getState().pushTimelineCard(card);
        })
        .finally(() => {
          const { sessionConnected } = useAppStore.getState();
          useAppStore.getState().setVoiceState(sessionConnected ? "listening" : "idle");
        });
    });

    this.socket.on(WS_EVENTS.TIMELINE_CARD_CREATED, (card: TimelineCard) => {
      debugLog("ws", "event.timeline_card_created", {
        cardId: card.id,
        type: card.type,
        status: card.status
      });
      useAppStore.getState().pushTimelineCard(card);
    });

    this.socket.on(WS_EVENTS.ACTION_PROPOSED, (proposal: ActionProposal) => {
      debugLog("ws", "event.action_proposed", {
        actionId: proposal.id,
        connectorId: proposal.connectorId,
        action: proposal.action
      });
      const current = useAppStore.getState().pendingActions;
      useAppStore.getState().setPendingActions([proposal, ...current]);
    });

    this.socket.on(WS_EVENTS.ACTION_EXECUTED, (payload: { actionId: string }) => {
      debugLog("ws", "event.action_executed", payload);
      useAppStore.getState().removePendingAction(payload.actionId);
    });

    this.socket.on(WS_EVENTS.ERROR_RAISED, (payload: { message: string }) => {
      debugLog("ws", "event.error_raised", payload);
      const card: TimelineCard = {
        id: `err-${Date.now()}`,
        type: "error",
        title: "Session error",
        body: payload.message,
        source: "session",
        timestamp: new Date().toISOString(),
        status: "error"
      };
      useAppStore.getState().pushTimelineCard(card);
      useAppStore.getState().setVoiceState("idle");
      this.setLocalSttStatus("provider_error", payload.message);
    });
  }

  private async handleConnectError(err: Error): Promise<void> {
    const message = err.message || "Voice session connection failed.";
    debugLog("ws", "connect_error.handle", {
      message,
      reconnectAttempts: this.reconnectAttempts
    });
    const card: TimelineCard = {
      id: `err-${Date.now()}`,
      type: "error",
      title: "Connection error",
      body: message,
      source: "session",
      timestamp: new Date().toISOString(),
      status: "error"
    };
    useAppStore.getState().pushTimelineCard(card);
    useAppStore.getState().setSessionConnected(false);
    useAppStore.getState().setVoiceState("idle");

    if (this.isAuthError(message) && !this.refreshingAuth) {
      this.refreshingAuth = true;
      this.setLocalSttStatus("warming_up", "Refreshing session token...");
      try {
        debugLog("ws", "auth.refresh.start");
        const refreshed = await apiClient.refreshSessionIfPossible();
        if (refreshed) {
          debugLog("ws", "auth.refresh.success");
          this.reconnectAttempts = 0;
          const { accessToken } = useAppStore.getState();
          if (this.socket && accessToken) {
            this.socket.auth = { token: accessToken };
            this.socket.connect();
            return;
          }
        }
        debugLog("ws", "auth.refresh.failed");
      } finally {
        this.refreshingAuth = false;
      }
    }

    this.setLocalSttStatus("warming_up", "Unable to connect. Retrying...");
    this.scheduleReconnect(message);
  }

  private scheduleReconnect(reason: string): void {
    if (this.manuallyDisconnected || !this.socket) {
      return;
    }
    if (this.reconnectAttempts >= AUTH_RETRY_LIMIT) {
      const card: TimelineCard = {
        id: `err-${Date.now()}`,
        type: "error",
        title: "Voice reconnect stopped",
        body: `Stopped reconnecting after repeated failures: ${reason}`,
        source: "session",
        timestamp: new Date().toISOString(),
        status: "error"
      };
      useAppStore.getState().pushTimelineCard(card);
      this.setLocalSttStatus("provider_error", "Voice reconnect limit reached.");
      debugLog("ws", "reconnect.stopped", { reason });
      return;
    }

    this.clearReconnectTimer();
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts
    );
    this.reconnectAttempts += 1;
    debugLog("ws", "reconnect.scheduled", {
      reason,
      delayMs: delay,
      attempt: this.reconnectAttempts
    });
    this.reconnectTimer = setTimeout(() => {
      if (this.socket && !this.manuallyDisconnected) {
        debugLog("ws", "reconnect.attempt", { attempt: this.reconnectAttempts });
        this.socket.connect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleListeningStatusReset(): void {
    this.clearSttStatusResetTimer();
    this.sttStatusResetTimer = setTimeout(() => {
      const { sessionConnected } = useAppStore.getState();
      if (!sessionConnected) {
        return;
      }
      useAppStore.getState().setSttStatus({
        code: "listening",
        message: "Listening for your request."
      });
    }, 2200);
  }

  private clearSttStatusResetTimer(): void {
    if (this.sttStatusResetTimer) {
      clearTimeout(this.sttStatusResetTimer);
      this.sttStatusResetTimer = null;
    }
  }

  private isAuthError(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes("token") || lower.includes("unauth") || lower.includes("forbidden");
  }
}

export const sessionSocket = new SessionSocket();
