import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ActionDraft, ActionStatusEvent } from "@mark/contracts";

import type { ProviderDiagnosticItem } from "./types";
import { VoiceStage } from "./VoiceStage";

const diagnostics: ProviderDiagnosticItem[] = [
  { label: "STT", value: "ready" },
  { label: "LLM", value: "ready" }
];

const pendingAction: ActionDraft = {
  actionId: "action-1",
  revisionId: "revision-1",
  status: "pending_approval",
  toolSlug: "gmail_send_email",
  toolkitSlug: "gmail",
  connectedAccountId: "acct-1",
  summary: "Send this email draft to product@company.com",
  arguments: {
    to: "product@company.com"
  },
  requiresApproval: true,
  createdAt: "2026-03-01T08:00:00.000Z",
  updatedAt: "2026-03-01T08:00:00.000Z"
};

describe("VoiceStage", () => {
  it("calls stop when top-left close button is pressed", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();

    render(
      <VoiceStage
        {...createBaseProps()}
        isRunning
        onStop={onStop}
      />
    );

    await user.click(screen.getByRole("button", { name: "Stop voice session" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("opens and closes settings drawer", async () => {
    const user = userEvent.setup();

    render(<VoiceStage {...createBaseProps()} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("heading", { name: "Session Controls" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Session Controls" })).not.toBeInTheDocument();
  });

  it("renders approval actions for pending notifications and handles clicks", async () => {
    const user = userEvent.setup();
    const onApprovePending = vi.fn();
    const onRejectPending = vi.fn();

    render(
      <VoiceStage
        {...createBaseProps()}
        pendingAction={pendingAction}
        actionTimeline={[
          {
            id: "event-1",
            actionId: pendingAction.actionId,
            revisionId: pendingAction.revisionId,
            type: "action.proposed",
            message: "Draft ready for your approval.",
            createdAt: "2026-03-01T08:00:00.000Z"
          }
        ]}
        onApprovePending={onApprovePending}
        onRejectPending={onRejectPending}
      />
    );

    await user.click(await screen.findByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(onApprovePending).toHaveBeenCalledTimes(1);
    expect(onRejectPending).toHaveBeenCalledTimes(1);
  });

  it("prioritizes partial transcript in the stage caption", () => {
    render(
      <VoiceStage
        {...createBaseProps()}
        userFinal="Past user sentence"
        agentFinal="Past agent sentence"
        agentPartial="Streaming now"
      />
    );

    expect(screen.getByText(/Agent: Streaming now/i)).toBeInTheDocument();
  });
});

function createBaseProps(): ComponentProps<typeof VoiceStage> {
  return {
    connected: true,
    isRunning: false,
    voiceState: "idle",
    audioLevel: 0,
    sessionId: "session-1",
    userPartial: "",
    userFinal: "",
    agentPartial: "",
    agentFinal: "",
    pendingAction: null,
    actionStatus: null as ActionStatusEvent | null,
    actionTimeline: [],
    sttMessage: null,
    actionStatusMessage: null,
    activeTtsProvider: null,
    providerDiagnostics: diagnostics,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onResetMemory: vi.fn(),
    onSignOut: vi.fn(),
    onApprovePending: vi.fn(),
    onRejectPending: vi.fn(),
    loadingApps: false,
    appsSearch: "",
    onAppsSearchChange: vi.fn(),
    appsItems: [],
    connectingAuthConfigId: null,
    onConnectApp: vi.fn(),
    timelineSourceLabel: "No events",
    timelineItems: []
  };
}
