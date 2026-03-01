import { useMemo, useState } from "react";

import type { ActionDraft, ActionStatusEvent, VoiceState } from "@mark/contracts";

import { useActionNotifications } from "../hooks/useActionNotifications";
import type { CatalogListItem } from "../tabs/AppsTab";
import type { TimelineViewItem } from "../tabs/TimelineTab";
import type { StageMode } from "../uiTypes";
import type { ActionTimelineItem } from "../useVoiceAgent";
import { ActionNotificationLane } from "./ActionNotificationLane";
import { SettingsDrawer } from "./SettingsDrawer";
import type { ProviderDiagnosticItem } from "./types";
import { VoiceCoreShape } from "./VoiceCoreShape";

type VoiceStageProps = {
  connected: boolean;
  isRunning: boolean;
  voiceState: VoiceState;
  audioLevel: number;
  sessionId: string | null;
  userPartial: string;
  userFinal: string;
  agentPartial: string;
  agentFinal: string;
  pendingAction: ActionDraft | null;
  actionStatus: ActionStatusEvent | null;
  actionTimeline: ActionTimelineItem[];
  sttMessage: string | null;
  actionStatusMessage: string | null;
  activeTtsProvider: string | null;
  providerDiagnostics: ProviderDiagnosticItem[];
  onStart: () => void;
  onStop: () => void;
  onResetMemory: () => void;
  onSignOut: () => void;
  onApprovePending: () => void;
  onRejectPending: () => void;
  loadingApps: boolean;
  appsSearch: string;
  onAppsSearchChange: (value: string) => void;
  appsItems: CatalogListItem[];
  connectingAuthConfigId: string | null;
  onConnectApp: (authConfigId: string) => void;
  timelineSourceLabel: string;
  timelineItems: TimelineViewItem[];
};

export function VoiceStage({
  connected,
  isRunning,
  voiceState,
  audioLevel,
  sessionId,
  userPartial,
  userFinal,
  agentPartial,
  agentFinal,
  pendingAction,
  actionStatus,
  actionTimeline,
  sttMessage,
  actionStatusMessage,
  activeTtsProvider,
  providerDiagnostics,
  onStart,
  onStop,
  onResetMemory,
  onSignOut,
  onApprovePending,
  onRejectPending,
  loadingApps,
  appsSearch,
  onAppsSearchChange,
  appsItems,
  connectingAuthConfigId,
  onConnectApp,
  timelineSourceLabel,
  timelineItems
}: VoiceStageProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const notifications = useActionNotifications({
    actionTimeline,
    pendingAction,
    actionStatus
  });

  const stageMode = useMemo<StageMode>(() => {
    if (actionStatus?.status === "executing") {
      return "acting";
    }
    switch (voiceState) {
      case "listening":
        return "listening";
      case "thinking":
        return "thinking";
      case "speaking":
        return "speaking";
      default:
        return "idle";
    }
  }, [actionStatus?.status, voiceState]);

  const caption = useMemo(() => {
    const partialUser = userPartial.trim();
    if (partialUser.length > 0) {
      return shorten(`You: ${partialUser}`);
    }

    const partialAgent = agentPartial.trim();
    if (partialAgent.length > 0) {
      return shorten(`Agent: ${partialAgent}`);
    }

    if (stageMode === "thinking" || stageMode === "acting") {
      return "Agent is working on your request...";
    }

    const finalAgent = agentFinal.trim();
    if (finalAgent.length > 0) {
      return shorten(`Agent: ${finalAgent}`);
    }

    const finalUser = userFinal.trim();
    if (finalUser.length > 0) {
      return shorten(`You: ${finalUser}`);
    }

    if (isRunning) {
      return "Listening for your voice...";
    }

    return "Open settings or tap start to begin.";
  }, [agentFinal, agentPartial, isRunning, stageMode, userFinal, userPartial]);

  return (
    <section className="voice-stage" aria-label="Voice stage">
      <header className="voice-stage-nav">
        <button className="stage-icon-btn" onClick={onStop} aria-label="Stop voice session" disabled={!isRunning}>
          ×
        </button>
        <p className="stage-status">{connected ? stageMode : "offline"}</p>
        <button className="stage-icon-btn stage-settings-btn" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </header>

      <div className="voice-stage-center">
        <VoiceCoreShape stageMode={stageMode} audioLevel={audioLevel} isRunning={isRunning} />
        <p className="stage-caption">{caption}</p>
        {!isRunning ? (
          <button className="btn btn-primary stage-start-btn" onClick={onStart}>
            Start Listening
          </button>
        ) : null}
      </div>

      <ActionNotificationLane
        notifications={notifications}
        pendingAction={pendingAction}
        onApprovePending={onApprovePending}
        onRejectPending={onRejectPending}
      />

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        isRunning={isRunning}
        canResetMemory={connected}
        sessionId={sessionId}
        sttMessage={sttMessage}
        actionStatusMessage={actionStatusMessage}
        activeTtsProvider={activeTtsProvider}
        providerDiagnostics={providerDiagnostics}
        onStart={onStart}
        onStop={onStop}
        onResetMemory={onResetMemory}
        onSignOut={onSignOut}
        loadingApps={loadingApps}
        appsSearch={appsSearch}
        onAppsSearchChange={onAppsSearchChange}
        appsItems={appsItems}
        connectingAuthConfigId={connectingAuthConfigId}
        onConnectApp={onConnectApp}
        timelineSourceLabel={timelineSourceLabel}
        timelineItems={timelineItems}
      />
    </section>
  );
}

function shorten(value: string): string {
  if (value.length <= 140) {
    return value;
  }
  return `${value.slice(0, 137)}...`;
}
