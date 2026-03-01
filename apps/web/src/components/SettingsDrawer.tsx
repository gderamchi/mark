import { useEffect } from "react";

import type { CatalogListItem } from "../tabs/AppsTab";
import AppsTab from "../tabs/AppsTab";
import TimelineTab, { type TimelineViewItem } from "../tabs/TimelineTab";
import type { ProviderDiagnosticItem } from "./types";

type SettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  isRunning: boolean;
  canResetMemory: boolean;
  sessionId: string | null;
  sttMessage: string | null;
  actionStatusMessage: string | null;
  activeTtsProvider: string | null;
  providerDiagnostics: ProviderDiagnosticItem[];
  onStart: () => void;
  onStop: () => void;
  onResetMemory: () => void;
  onSignOut: () => void;
  loadingApps: boolean;
  appsSearch: string;
  onAppsSearchChange: (value: string) => void;
  appsItems: CatalogListItem[];
  connectingAuthConfigId: string | null;
  onConnectApp: (authConfigId: string) => void;
  timelineSourceLabel: string;
  timelineItems: TimelineViewItem[];
};

export function SettingsDrawer({
  open,
  onClose,
  isRunning,
  canResetMemory,
  sessionId,
  sttMessage,
  actionStatusMessage,
  activeTtsProvider,
  providerDiagnostics,
  onStart,
  onStop,
  onResetMemory,
  onSignOut,
  loadingApps,
  appsSearch,
  onAppsSearchChange,
  appsItems,
  connectingAuthConfigId,
  onConnectApp,
  timelineSourceLabel,
  timelineItems
}: SettingsDrawerProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <>
      <button className="settings-backdrop" onClick={onClose} aria-label="Close settings panel" />
      <aside className="settings-drawer" role="dialog" aria-modal="true" aria-label="Voice settings and controls">
        <header className="settings-head">
          <h2>Settings</h2>
          <button className="btn btn-compact" onClick={onClose}>
            Close
          </button>
        </header>

        <section className="card settings-session stack-md">
          <header className="card-head">
            <h3>Session Controls</h3>
            <p className="compact-text muted status-mono">{sessionId ?? "no session"}</p>
          </header>
          <div className="control-row">
            {!isRunning ? (
              <button className="btn btn-primary" onClick={onStart}>
                Start Listening
              </button>
            ) : (
              <button className="btn btn-danger" onClick={onStop}>
                Stop Listening
              </button>
            )}
            <button className="btn" onClick={onResetMemory} disabled={!canResetMemory}>
              Reset Memory
            </button>
            <button className="btn btn-quiet" onClick={onSignOut}>
              Sign Out
            </button>
          </div>
          <dl className="status-list compact-text">
            <div>
              <dt>Action</dt>
              <dd>{actionStatusMessage ?? "No action updates yet."}</dd>
            </div>
            <div>
              <dt>STT</dt>
              <dd>{sttMessage ?? "No status yet."}</dd>
            </div>
            <div>
              <dt>TTS provider</dt>
              <dd>{activeTtsProvider ?? "none"}</dd>
            </div>
          </dl>
        </section>

        <section className="card stack-sm">
          <header className="card-head">
            <h3>Runtime Diagnostics</h3>
          </header>
          <dl className="status-list compact-text stack-sm">
            {providerDiagnostics.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="settings-panel">
          <h3>Connected Apps</h3>
          <AppsTab
            loading={loadingApps}
            search={appsSearch}
            onSearchChange={onAppsSearchChange}
            items={appsItems}
            connectingAuthConfigId={connectingAuthConfigId}
            onConnect={onConnectApp}
          />
        </section>

        <section className="settings-panel">
          <h3>Timeline</h3>
          <TimelineTab sourceLabel={timelineSourceLabel} items={timelineItems} />
        </section>
      </aside>
    </>
  );
}
