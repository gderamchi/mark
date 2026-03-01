export type MobileTabId = "voice" | "actions" | "apps" | "timeline";

export type DesktopTabId = Exclude<MobileTabId, "voice">;

export type UiDensityMode = "mobile" | "tablet" | "desktop";

export type StageMode = "idle" | "listening" | "thinking" | "speaking" | "acting";

export type TaskNotificationTone = "working" | "approval" | "success" | "error";

export type TaskNotificationVisualState = "visible" | "exiting";

export type TaskNotification = {
  id: string;
  signature: string;
  actionId: string | null;
  revisionId: string | null;
  type: string;
  message: string;
  platformLabel: string;
  tone: TaskNotificationTone;
  visualState: TaskNotificationVisualState;
  createdAt: string;
};
