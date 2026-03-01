import type { TaskNotification } from "../uiTypes";

type ActionNotificationCardProps = {
  notification: TaskNotification;
  showApprovalControls: boolean;
  onApprovePending: () => void;
  onRejectPending: () => void;
};

export function ActionNotificationCard({
  notification,
  showApprovalControls,
  onApprovePending,
  onRejectPending
}: ActionNotificationCardProps) {
  const eventLabel = EVENT_LABELS[notification.type] ?? "Action update";

  return (
    <article
      className={`task-notification tone-${notification.tone} state-${notification.visualState}`}
      data-tone={notification.tone}
      aria-live={notification.tone === "error" ? "assertive" : "polite"}
    >
      <header className="task-notification-head">
        <p className="task-platform">{notification.platformLabel}</p>
        <p className="task-event">{eventLabel}</p>
      </header>

      <p className="task-message">{notification.message}</p>

      {showApprovalControls ? (
        <div className="task-approval">
          <p className="compact-text">
            Say "approve" or "reject", or decide here:
          </p>
          <div className="task-approval-actions">
            <button className="btn btn-primary btn-compact" onClick={onApprovePending}>
              Approve
            </button>
            <button className="btn btn-compact" onClick={onRejectPending}>
              Reject
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

const EVENT_LABELS: Record<string, string> = {
  "action.proposed": "Awaiting approval",
  "action.revised": "Draft revised",
  "action.status": "In progress",
  "action.executed": "Completed",
  "action.rejected": "Rejected",
  "action.failed": "Failed"
};
