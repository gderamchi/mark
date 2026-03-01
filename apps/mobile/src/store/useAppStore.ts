import { create } from "zustand";

import type {
  ActionProposal,
  AuditEvent,
  ConnectorView,
  SttStatusEvent,
  TimelineCard,
  VoiceState
} from "@mark/contracts";

interface AppState {
  userId: string;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  voiceState: VoiceState;
  sessionConnected: boolean;
  sttPartial: string;
  sttStatus: SttStatusEvent | null;
  audioLevel: number;
  latestReply: string;
  timelineCards: TimelineCard[];
  connectors: ConnectorView[];
  auditEvents: AuditEvent[];
  pendingActions: ActionProposal[];
  setAuthSession: (session: {
    userId: string;
    email: string;
    accessToken: string;
    refreshToken: string;
  }) => void;
  clearAuthSession: () => void;
  setVoiceState: (state: VoiceState) => void;
  setSessionConnected: (connected: boolean) => void;
  setSttPartial: (text: string) => void;
  setSttStatus: (status: SttStatusEvent | null) => void;
  setAudioLevel: (level: number) => void;
  setLatestReply: (text: string) => void;
  pushTimelineCard: (card: TimelineCard) => void;
  setConnectors: (connectors: ConnectorView[]) => void;
  setAuditEvents: (events: AuditEvent[]) => void;
  setPendingActions: (actions: ActionProposal[]) => void;
  removePendingAction: (actionId: string) => void;
  resetSessionData: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  userId: "demo-user",
  email: null,
  accessToken: null,
  refreshToken: null,
  voiceState: "idle",
  sessionConnected: false,
  sttPartial: "",
  sttStatus: null,
  audioLevel: 0,
  latestReply: "",
  timelineCards: [],
  connectors: [],
  auditEvents: [],
  pendingActions: [],
  setAuthSession: ({ userId, email, accessToken, refreshToken }) =>
    set({
      userId,
      email,
      accessToken,
      refreshToken
    }),
  clearAuthSession: () =>
    set({
      userId: "demo-user",
      email: null,
      accessToken: null,
      refreshToken: null,
      voiceState: "idle",
      sessionConnected: false,
      sttPartial: "",
      sttStatus: null,
      audioLevel: 0,
      latestReply: "",
      timelineCards: [],
      connectors: [],
      auditEvents: [],
      pendingActions: []
    }),
  setVoiceState: (voiceState) => set({ voiceState }),
  setSessionConnected: (sessionConnected) => set({ sessionConnected }),
  setSttPartial: (sttPartial) => set({ sttPartial }),
  setSttStatus: (sttStatus) => set({ sttStatus }),
  setAudioLevel: (audioLevel) => set({ audioLevel }),
  setLatestReply: (latestReply) => set({ latestReply }),
  pushTimelineCard: (card) =>
    set((state) => ({
      timelineCards: [card, ...state.timelineCards].slice(0, 120)
    })),
  setConnectors: (connectors) => set({ connectors }),
  setAuditEvents: (auditEvents) => set({ auditEvents }),
  setPendingActions: (pendingActions) => set({ pendingActions }),
  removePendingAction: (actionId) =>
    set((state) => ({
      pendingActions: state.pendingActions.filter((action) => action.id !== actionId)
    })),
  resetSessionData: () =>
    set({
      voiceState: "idle",
      sessionConnected: false,
      sttPartial: "",
      sttStatus: null,
      audioLevel: 0,
      latestReply: "",
      timelineCards: [],
      pendingActions: []
    })
}));
