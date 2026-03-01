declare module "lamejsfixbug121" {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number);
    encodeBuffer(left: Int16Array): Uint8Array;
    flush(): Uint8Array;
  }
}
