class Pcm16CaptureWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options?.processorOptions ?? {};
    this.targetSampleRate = Number(processorOptions.targetSampleRate ?? 16000);
    this.chunkMs = Number(processorOptions.chunkMs ?? 250);
    this.samplesPerChunk = Math.max(1, Math.floor((this.targetSampleRate * this.chunkMs) / 1000));
    this.resampleBuffer = [];
    this.outputBuffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const mono = input[0];
    if (!mono || mono.length === 0) {
      return true;
    }

    const inputRate = sampleRate;
    const ratio = inputRate / this.targetSampleRate;

    for (let i = 0; i < mono.length; i += 1) {
      this.resampleBuffer.push(mono[i]);
    }

    if (ratio <= 1) {
      this.flushToOutput(this.resampleBuffer);
      this.resampleBuffer = [];
    } else {
      while (this.resampleBuffer.length >= ratio) {
        const windowSize = Math.floor(ratio);
        if (windowSize <= 0) {
          break;
        }

        let sum = 0;
        for (let i = 0; i < windowSize; i += 1) {
          sum += this.resampleBuffer[i];
        }
        const averaged = sum / windowSize;
        this.flushToOutput([averaged]);
        this.resampleBuffer.splice(0, windowSize);
      }
    }

    while (this.outputBuffer.length >= this.samplesPerChunk) {
      const slice = this.outputBuffer.splice(0, this.samplesPerChunk);
      const int16 = new Int16Array(slice.length);
      for (let i = 0; i < slice.length; i += 1) {
        const clamped = Math.max(-1, Math.min(1, slice[i]));
        int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      }

      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true;
  }

  flushToOutput(values) {
    for (let i = 0; i < values.length; i += 1) {
      this.outputBuffer.push(values[i]);
    }
  }
}

registerProcessor("pcm16-capture-worklet", Pcm16CaptureWorklet);
