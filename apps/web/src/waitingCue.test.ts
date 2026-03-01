import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WaitingCuePlayer } from "./waitingCue";

type AudioContextCtor = new () => AudioContext;

type MockMetrics = {
  oscillatorCount: number;
  resumeCount: number;
  closeCount: number;
};

describe("WaitingCuePlayer", () => {
  let originalAudioContextDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    originalAudioContextDescriptor = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalAudioContextDescriptor) {
      Object.defineProperty(globalThis, "AudioContext", originalAudioContextDescriptor);
    } else {
      delete (globalThis as { AudioContext?: unknown }).AudioContext;
    }
  });

  it("schedules a tum-tum-tum pattern after delay and repeats it", () => {
    const metrics = createMockMetrics();
    installAudioContextMock(createAudioContextMock(metrics));

    const cue = new WaitingCuePlayer();
    cue.start();

    expect(metrics.oscillatorCount).toBe(0);
    vi.advanceTimersByTime(1199);
    expect(metrics.oscillatorCount).toBe(0);

    vi.advanceTimersByTime(1);
    expect(metrics.oscillatorCount).toBe(1);

    vi.advanceTimersByTime(190);
    expect(metrics.oscillatorCount).toBe(2);
    vi.advanceTimersByTime(190);
    expect(metrics.oscillatorCount).toBe(3);

    vi.advanceTimersByTime(1419);
    expect(metrics.oscillatorCount).toBe(3);

    vi.advanceTimersByTime(1);
    expect(metrics.oscillatorCount).toBe(4);
    vi.advanceTimersByTime(190);
    expect(metrics.oscillatorCount).toBe(5);
    vi.advanceTimersByTime(190);
    expect(metrics.oscillatorCount).toBe(6);

    cue.dispose();
  });

  it("does not duplicate timers when start is called repeatedly", () => {
    const metrics = createMockMetrics();
    installAudioContextMock(createAudioContextMock(metrics));

    const cue = new WaitingCuePlayer();
    cue.start();
    cue.start();
    cue.start();

    vi.advanceTimersByTime(1200 + 190 + 190);
    expect(metrics.oscillatorCount).toBe(3);

    vi.advanceTimersByTime(1800 + 190 + 190);
    expect(metrics.oscillatorCount).toBe(6);

    cue.dispose();
  });

  it("cancels pending beats on stop", () => {
    const metrics = createMockMetrics();
    installAudioContextMock(createAudioContextMock(metrics));

    const cue = new WaitingCuePlayer();
    cue.start();

    vi.advanceTimersByTime(1200);
    expect(metrics.oscillatorCount).toBe(1);

    cue.stop();
    vi.advanceTimersByTime(15000);
    expect(metrics.oscillatorCount).toBe(1);

    cue.dispose();
  });

  it("does not throw when AudioContext is unavailable", () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;

    const cue = new WaitingCuePlayer();
    expect(() => cue.start()).not.toThrow();
    expect(() => vi.advanceTimersByTime(12000)).not.toThrow();

    cue.dispose();
  });
});

function createMockMetrics(): MockMetrics {
  return {
    oscillatorCount: 0,
    resumeCount: 0,
    closeCount: 0
  };
}

function installAudioContextMock(ctor: AudioContextCtor): void {
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    writable: true,
    value: ctor
  });
}

function createAudioContextMock(metrics: MockMetrics): AudioContextCtor {
  class MockAudioContextImpl {
    currentTime = 0;
    state: AudioContextState = "running";
    destination = {} as AudioDestinationNode;

    createOscillator(): OscillatorNode {
      metrics.oscillatorCount += 1;
      return createOscillatorMock();
    }

    createGain(): GainNode {
      return createGainNodeMock();
    }

    async resume(): Promise<void> {
      metrics.resumeCount += 1;
      this.state = "running";
    }

    async close(): Promise<void> {
      metrics.closeCount += 1;
      this.state = "closed";
    }
  }

  return MockAudioContextImpl as unknown as AudioContextCtor;
}

function createOscillatorMock(): OscillatorNode {
  const oscillatorLike = {
    type: "sine" as OscillatorType,
    frequency: { value: 0 } as AudioParam,
    connect: () => undefined,
    disconnect: () => undefined,
    start: () => undefined,
    stop: () => undefined,
    onended: null as OscillatorNode["onended"]
  };
  return oscillatorLike as unknown as OscillatorNode;
}

function createGainNodeMock(): GainNode {
  const gainParamLike = {
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined
  } as unknown as AudioParam;

  const gainNodeLike = {
    gain: gainParamLike,
    connect: () => undefined,
    disconnect: () => undefined
  };
  return gainNodeLike as unknown as GainNode;
}
