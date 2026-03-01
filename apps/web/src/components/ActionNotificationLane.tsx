import type { ActionDraft } from "@mark/contracts";

import type { TaskNotification } from "../uiTypes";
import { ActionNotificationCard } from "./ActionNotificationCard";

type ActionNotificationLaneProps = {
  notifications: TaskNotification[];
  pendingAction: ActionDraft | null;
  onApprovePending: () => void;
  onRejectPending: () => void;
};

export function ActionNotificationLane({
  notifications,
  pendingAction,
  onApprovePending,
  onRejectPending
}: ActionNotificationLaneProps) {
  if (notifications.length === 0) {
    return null;
  }

  return (
    <aside className="task-lane" aria-label="Task notifications">
      {notifications.map((notification) => {
        const showApprovalControls =
          !!pendingAction &&
          notification.actionId === pendingAction.actionId &&
          notification.revisionId === pendingAction.revisionId &&
          notification.tone === "approval";

        return (
          <ActionNotificationCard
            key={notification.id}
            notification={notification}
            showApprovalControls={showApprovalControls}
            onApprovePending={onApprovePending}
            onRejectPending={onRejectPending}
          />
        );
      })}
    </aside>
  );
}
