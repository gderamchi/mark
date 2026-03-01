export type MicChunkEvent = {
  pcm16: Int16Array;
  rms: number;
};

export class MicrophonePipeline {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private muteGain: GainNode | null = null;

  constructor(private readonly onChunk: (event: MicChunkEvent) => void) {}

  async start(): Promise<void> {
    if (this.stream) {
      return;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    this.audioContext = new AudioContext();
    await this.audioContext.audioWorklet.addModule("/audio-capture.worklet.js");

    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioContext, "pcm16-capture-worklet", {
      processorOptions: {
        targetSampleRate: 16000,
        chunkMs: 250
      }
    });

    this.muteGain = this.audioContext.createGain();
    this.muteGain.gain.value = 0;

    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.muteGain);
    this.muteGain.connect(this.audioContext.destination);

    this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const pcm16 = new Int16Array(event.data);
      const rms = computeRms(pcm16);
      this.onChunk({ pcm16, rms });
    };
  }

  async stop(): Promise<void> {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.muteGain) {
      this.muteGain.disconnect();
      this.muteGain = null;
    }

    if (this.audioContext) {
      await this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }
}

function computeRms(pcm16: Int16Array): number {
  if (pcm16.length === 0) {
    return 0;
  }

  let sumSquares = 0;
  for (let i = 0; i < pcm16.length; i += 1) {
    const normalized = pcm16[i] / 32768;
    sumSquares += normalized * normalized;
  }

  return Math.sqrt(sumSquares / pcm16.length);
}
