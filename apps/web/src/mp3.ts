import { Mp3Encoder } from "lamejsfixbug121";

const MP3_BLOCK_SIZE = 1152;

export function encodePcmChunksToMp3Base64(chunks: Int16Array[], sampleRate: 16000): string {
  const samples = concatInt16Chunks(chunks);
  if (samples.length === 0) {
    return "";
  }

  const encoder = new Mp3Encoder(1, sampleRate, 96);
  const encodedChunks: Uint8Array[] = [];

  for (let i = 0; i < samples.length; i += MP3_BLOCK_SIZE) {
    const block = samples.subarray(i, i + MP3_BLOCK_SIZE);
    const encoded = encoder.encodeBuffer(block);
    if (encoded.length > 0) {
      encodedChunks.push(new Uint8Array(encoded));
    }
  }

  const flush = encoder.flush();
  if (flush.length > 0) {
    encodedChunks.push(new Uint8Array(flush));
  }

  const bytes = concatUint8Chunks(encodedChunks);
  return bytesToBase64(bytes);
}

function concatInt16Chunks(chunks: Int16Array[]): Int16Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }

  const merged = new Int16Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function concatUint8Chunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }

  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}
