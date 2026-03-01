type VoiceTabProps = {
  isRunning: boolean;
  canResetMemory: boolean;
  userFinal: string;
  userPartial: string;
  agentFinal: string;
  agentPartial: string;
  audioLevel: number;
  onStart: () => void;
  onStop: () => void;
  onResetMemory: () => void;
};

export function VoiceTab({
  isRunning,
  canResetMemory,
  userFinal,
  userPartial,
  agentFinal,
  agentPartial,
  audioLevel,
  onStart,
  onStop,
  onResetMemory
}: VoiceTabProps) {
  const level = Math.max(0, Math.min(1, audioLevel * 4));

  return (
    <section className="tab-flow" aria-label="Voice Session">
      <article className="card sticky-controls">
        <div className="control-row">
          {!isRunning ? (
            <button className="btn btn-primary btn-large btn-main-action" onClick={onStart}>
              Start Listening
            </button>
          ) : (
            <button className="btn btn-danger btn-large btn-main-action" onClick={onStop}>
              Stop Listening
            </button>
          )}
          <button className="btn btn-compact" onClick={onResetMemory} disabled={!canResetMemory}>
            Reset Memory
          </button>
        </div>
        <p className="compact-text muted">
          Read actions auto-run. Write actions require approval.
        </p>
        <div className="voice-meter-wrap" aria-live="off">
          <label htmlFor="voice-level">Mic level</label>
          <meter id="voice-level" min={0} max={1} value={level} />
        </div>
      </article>

      <div className="transcript-grid">
        <article className="card transcript-panel">
          <header>
            <h2>Your Voice</h2>
            <p className="compact-text muted">Live transcript</p>
          </header>
          <p className="final-text scroll-body">{userFinal || "Speak to begin."}</p>
          <p className="partial-text">{userPartial || " "}</p>
        </article>

        <article className="card transcript-panel">
          <header>
            <h2>Agent Voice</h2>
            <p className="compact-text muted">Live response</p>
          </header>
          <p className="final-text scroll-body">{agentFinal || "Waiting for your first prompt."}</p>
          <p className="partial-text">{agentPartial || " "}</p>
        </article>
      </div>
    </section>
  );
}
