type AudioContextCtor = new () => AudioContext;

type WaitingCueOptions = {
  initialDelayMs?: number;
  patternIntervalMs?: number;
  beatIntervalMs?: number;
  beatsPerPattern?: number;
  frequencyHz?: number;
  volume?: number;
  attackMs?: number;
  sustainMs?: number;
  releaseMs?: number;
};

const DEFAULT_OPTIONS: Required<WaitingCueOptions> = {
  initialDelayMs: 1200,
  patternIntervalMs: 1800,
  beatIntervalMs: 190,
  beatsPerPattern: 3,
  frequencyHz: 520,
  volume: 0.015,
  attackMs: 10,
  sustainMs: 30,
  releaseMs: 95
};

export class WaitingCuePlayer {
  private context: AudioContext | null = null;
  private startTimerId: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private beatTimerIds = new Set<ReturnType<typeof setTimeout>>();
  private started = false;
  private readonly options: Required<WaitingCueOptions>;

  constructor(options: WaitingCueOptions = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options
    };
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.startTimerId = setTimeout(() => {
      this.startTimerId = null;
      if (!this.started) {
        return;
      }

      this.playBeatPattern();
      this.intervalId = setInterval(() => {
        this.playBeatPattern();
      }, this.options.patternIntervalMs);
    }, this.options.initialDelayMs);
  }

  stop(): void {
    this.started = false;
    if (this.startTimerId !== null) {
      clearTimeout(this.startTimerId);
      this.startTimerId = null;
    }
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    for (const beatTimerId of this.beatTimerIds) {
      clearTimeout(beatTimerId);
    }
    this.beatTimerIds.clear();
  }

  dispose(): void {
    this.stop();
    const context = this.context;
    this.context = null;
    if (context) {
      void context.close().catch(() => undefined);
    }
  }

  private async playPulse(): Promise<void> {
    try {
      const context = this.ensureContext();
      if (!context) {
        return;
      }

      if (context.state === "suspended") {
        await context.resume().catch(() => undefined);
      }

      if (!this.started) {
        return;
      }

      const now = context.currentTime;
      const attackSeconds = this.options.attackMs / 1000;
      const sustainSeconds = this.options.sustainMs / 1000;
      const releaseSeconds = this.options.releaseMs / 1000;
      const endTime = now + attackSeconds + sustainSeconds + releaseSeconds;

      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = this.options.frequencyHz;

      const gainNode = context.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(this.options.volume, now + attackSeconds);
      gainNode.gain.setValueAtTime(this.options.volume, now + attackSeconds + sustainSeconds);
      gainNode.gain.linearRampToValueAtTime(0, endTime);

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(endTime + 0.01);
      oscillator.onended = () => {
        oscillator.disconnect();
        gainNode.disconnect();
      };
    } catch {
      // Avoid breaking voice flow when audio APIs are unavailable or blocked.
    }
  }

  private playBeatPattern(): void {
    if (!this.started) {
      return;
    }

    void this.playPulse();
    for (let beat = 1; beat < this.options.beatsPerPattern; beat += 1) {
      const beatTimerId = setTimeout(() => {
        this.beatTimerIds.delete(beatTimerId);
        if (!this.started) {
          return;
        }
        void this.playPulse();
      }, beat * this.options.beatIntervalMs);
      this.beatTimerIds.add(beatTimerId);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context) {
      return this.context;
    }

    const Ctor = getAudioContextCtor();
    if (!Ctor) {
      return null;
    }

    try {
      this.context = new Ctor();
      return this.context;
    } catch {
      return null;
    }
  }
}

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const scope = window as Window &
    typeof globalThis & {
      webkitAudioContext?: AudioContextCtor;
    };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}
