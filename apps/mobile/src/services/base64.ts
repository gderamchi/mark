import { Buffer } from "buffer";

export function encodeBase64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function decodeBase64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

export function decodeBase64ToString(base64: string): string {
  return Buffer.from(base64, "base64").toString("utf8");
}
