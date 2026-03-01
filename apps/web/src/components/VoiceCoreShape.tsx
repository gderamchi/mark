import type { CSSProperties } from "react";

import type { StageMode } from "../uiTypes";

type VoiceCoreShapeProps = {
  stageMode: StageMode;
  audioLevel: number;
  isRunning: boolean;
};

export function VoiceCoreShape({ stageMode, audioLevel, isRunning }: VoiceCoreShapeProps) {
  const normalizedLevel = clamp01(audioLevel * 4);
  const energy = isRunning ? 0.5 + normalizedLevel * 0.5 : 0.2;
  const style = {
    "--voice-level": normalizedLevel.toFixed(3),
    "--voice-energy": energy.toFixed(3)
  } as CSSProperties;

  return (
    <div
      className={`voice-core voice-core-${stageMode} ${isRunning ? "is-running" : "is-idle"}`}
      data-stage-mode={stageMode}
      style={style}
      role="img"
      aria-label={`Voice state: ${stageMode}`}
    >
      <span className="voice-core-orbit" aria-hidden />
      <span className="voice-core-halo" aria-hidden />
      <span className="voice-core-ring voice-core-ring-a" aria-hidden />
      <span className="voice-core-ring voice-core-ring-b" aria-hidden />
      <span className="voice-core-node">
        <span className="voice-core-dot" aria-hidden />
      </span>
    </div>
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
