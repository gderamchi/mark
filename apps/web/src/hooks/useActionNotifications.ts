import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { ActionDraft, ActionStatusEvent } from "@mark/contracts";

import type { TaskNotification, TaskNotificationTone } from "../uiTypes";
import type { ActionTimelineItem } from "../useVoiceAgent";

type UseActionNotificationsInput = {
  actionTimeline: ActionTimelineItem[];
  pendingAction: ActionDraft | null;
  actionStatus: ActionStatusEvent | null;
};

const TERMINAL_DISMISS_MS = 2400;
const EXIT_ANIMATION_MS = 320;
const MAX_NOTIFICATIONS = 6;

export function useActionNotifications({
  actionTimeline,
  pendingAction,
  actionStatus
}: UseActionNotificationsInput): TaskNotification[] {
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const seenTimelineIdsRef = useRef(new Set<string>());
  const signatureToIdRef = useRef(new Map<string, string>());
  const dismissTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const removeTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const platformByActionIdRef = useRef(new Map<string, string>());

  useEffect(() => {
    return () => {
      clearTimerMap(dismissTimersRef.current);
      clearTimerMap(removeTimersRef.current);
    };
  }, []);

  const upsertNotification = (input: {
    signature: string;
    actionId: string | null;
    revisionId: string | null;
    type: string;
    message: string;
    platformLabel: string;
    tone: TaskNotificationTone;
    createdAt: string;
  }): string => {
    const existingId = signatureToIdRef.current.get(input.signature);
    const id = existingId ?? createNotificationId(input.signature);
    signatureToIdRef.current.set(input.signature, id);

    setNotifications((prev) => {
      const nextNotification: TaskNotification = {
        id,
        signature: input.signature,
        actionId: input.actionId,
        revisionId: input.revisionId,
        type: input.type,
        message: input.message,
        platformLabel: input.platformLabel,
        tone: input.tone,
        visualState: "visible",
        createdAt: input.createdAt
      };

      const withoutCurrent = prev.filter((item) => item.id !== id);
      const next = [nextNotification, ...withoutCurrent];
      return next.slice(0, MAX_NOTIFICATIONS);
    });

    return id;
  };

  const scheduleDismiss = (id: string): void => {
    clearNotificationTimers(id, dismissTimersRef.current, removeTimersRef.current);

    const dismissTimer = setTimeout(() => {
      setNotifications((prev) =>
        prev.map((item) => (item.id === id ? { ...item, visualState: "exiting" } : item))
      );

      const removeTimer = setTimeout(() => {
        removeNotificationById(id, setNotifications, signatureToIdRef.current);
        removeTimersRef.current.delete(id);
      }, EXIT_ANIMATION_MS);
      removeTimersRef.current.set(id, removeTimer);
      dismissTimersRef.current.delete(id);
    }, TERMINAL_DISMISS_MS);

    dismissTimersRef.current.set(id, dismissTimer);
  };

  const cancelDismiss = (id: string): void => {
    clearNotificationTimers(id, dismissTimersRef.current, removeTimersRef.current);
  };

  useEffect(() => {
    const ordered = [...actionTimeline].reverse();
    for (const item of ordered) {
      if (seenTimelineIdsRef.current.has(item.id)) {
        continue;
      }
      seenTimelineIdsRef.current.add(item.id);

      const signature = buildSignature(item.actionId, item.revisionId, item.type);
      const { tone, terminal } = classifyTimelineEvent(item.type, item.message);
      const id = upsertNotification({
        signature,
        actionId: item.actionId,
        revisionId: item.revisionId,
        type: item.type,
        message: item.message,
        tone,
        platformLabel: resolvePlatformLabel(item.actionId, platformByActionIdRef.current),
        createdAt: item.createdAt
      });

      if (terminal) {
        scheduleDismiss(id);
      } else {
        cancelDismiss(id);
      }
    }
  }, [actionTimeline]);

  useEffect(() => {
    if (!actionStatus) {
      return;
    }

    const signature = buildSignature(actionStatus.actionId, actionStatus.revisionId, "action.status");
    const { tone, terminal } = classifyActionStatus(actionStatus);
    const id = upsertNotification({
      signature,
      actionId: actionStatus.actionId,
      revisionId: actionStatus.revisionId,
      type: "action.status",
      message: actionStatus.message,
      tone,
      platformLabel: resolvePlatformLabel(actionStatus.actionId, platformByActionIdRef.current),
      createdAt: actionStatus.updatedAt
    });

    if (terminal) {
      scheduleDismiss(id);
    } else {
      cancelDismiss(id);
    }
  }, [actionStatus]);

  useEffect(() => {
    if (!pendingAction) {
      setNotifications((prev) => {
        const exitingIds: string[] = [];
        const next = prev.map((item) => {
          if (item.tone !== "approval") {
            return item;
          }
          if (item.visualState === "exiting") {
            return item;
          }
          exitingIds.push(item.id);
          return { ...item, visualState: "exiting" as const };
        });

        for (const id of exitingIds) {
          clearNotificationTimers(id, dismissTimersRef.current, removeTimersRef.current);
          const removeTimer = setTimeout(() => {
            removeNotificationById(id, setNotifications, signatureToIdRef.current);
            removeTimersRef.current.delete(id);
          }, EXIT_ANIMATION_MS);
          removeTimersRef.current.set(id, removeTimer);
        }

        return next;
      });
      return;
    }

    const platform =
      pendingAction.toolkitSlug?.trim() || pendingAction.toolSlug?.trim() || resolvePlatformLabel(null, platformByActionIdRef.current);
    platformByActionIdRef.current.set(pendingAction.actionId, platform);

    const signature = buildSignature(pendingAction.actionId, pendingAction.revisionId, "action.proposed");
    const id = upsertNotification({
      signature,
      actionId: pendingAction.actionId,
      revisionId: pendingAction.revisionId,
      type: "action.proposed",
      message: pendingAction.summary,
      tone: "approval",
      platformLabel: platform,
      createdAt: pendingAction.updatedAt
    });
    cancelDismiss(id);
  }, [pendingAction]);

  return notifications;
}

function buildSignature(actionId: string | null, revisionId: string | null, type: string): string {
  return `${actionId ?? "none"}:${revisionId ?? "none"}:${type}`;
}

function classifyTimelineEvent(
  type: string,
  message: string
): {
  tone: TaskNotificationTone;
  terminal: boolean;
} {
  switch (type) {
    case "action.proposed":
    case "action.revised":
      return { tone: "approval", terminal: false };
    case "action.executed":
      return { tone: "success", terminal: true };
    case "action.failed":
    case "action.rejected":
      return { tone: "error", terminal: true };
    case "action.status":
      return classifyStatusMessage(message);
    default:
      return { tone: "working", terminal: false };
  }
}

function classifyActionStatus(actionStatus: ActionStatusEvent): {
  tone: TaskNotificationTone;
  terminal: boolean;
} {
  switch (actionStatus.status) {
    case "pending_approval":
      return { tone: "approval", terminal: false };
    case "completed":
      return { tone: "success", terminal: true };
    case "rejected":
    case "failed":
      return { tone: "error", terminal: true };
    default:
      return { tone: "working", terminal: false };
  }
}

function classifyStatusMessage(message: string): {
  tone: TaskNotificationTone;
  terminal: boolean;
} {
  const normalized = message.trim().toLowerCase();
  if (
    normalized.includes("failed") ||
    normalized.includes("error") ||
    normalized.includes("rejected") ||
    normalized.includes("reject")
  ) {
    return { tone: "error", terminal: true };
  }
  if (normalized.includes("completed") || normalized.includes("executed") || normalized.includes("done")) {
    return { tone: "success", terminal: true };
  }
  if (normalized.includes("approval")) {
    return { tone: "approval", terminal: false };
  }
  return { tone: "working", terminal: false };
}

function clearNotificationTimers(
  id: string,
  dismissTimers: Map<string, ReturnType<typeof setTimeout>>,
  removeTimers: Map<string, ReturnType<typeof setTimeout>>
): void {
  const dismissTimer = dismissTimers.get(id);
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimers.delete(id);
  }

  const removeTimer = removeTimers.get(id);
  if (removeTimer) {
    clearTimeout(removeTimer);
    removeTimers.delete(id);
  }
}

function removeNotificationById(
  id: string,
  setNotifications: Dispatch<SetStateAction<TaskNotification[]>>,
  signatureToId: Map<string, string>
): void {
  setNotifications((prev) => prev.filter((item) => item.id !== id));
  for (const [signature, notificationId] of signatureToId.entries()) {
    if (notificationId === id) {
      signatureToId.delete(signature);
    }
  }
}

function createNotificationId(signature: string): string {
  return `${signature}:${Date.now().toString(16)}:${Math.random().toString(16).slice(2, 7)}`;
}

function resolvePlatformLabel(actionId: string | null, platformByActionId: Map<string, string>): string {
  if (actionId) {
    const known = platformByActionId.get(actionId);
    if (known) {
      return known;
    }
  }
  return "agent-task";
}

function clearTimerMap(timers: Map<string, ReturnType<typeof setTimeout>>): void {
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  timers.clear();
}
