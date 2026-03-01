import { NativeEventEmitter, NativeModules, Platform, type NativeModule } from "react-native";
import {
  AudioModule,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  IOSOutputFormat,
  AudioQuality,
  type RecordingOptions,
} from "expo-audio";
import { File } from "expo-file-system";

import { encodeBase64FromBytes } from "../services/base64";

export type MicPermissionStatus = "granted" | "denied";
export type NativeCaptureErrorCode =
  | "no_permission"
  | "invalid_hw_format"
  | "audio_session_error"
  | "engine_start_failed";

export type VoiceCaptureStartOptions = {
  enableLocalStt?: boolean;
};

export type LocalSttError = {
  code: string;
  message: string;
};

const LOCAL_STT_PARTIAL_EVENT = "voiceIO.sttPartial";
const LOCAL_STT_FINAL_EVENT = "voiceIO.sttFinal";
const LOCAL_STT_ERROR_EVENT = "voiceIO.sttError";

// --- Native VoiceIO (available in dev builds only) ---

const VoiceIO = NativeModules.VoiceIO as
  | (NativeModule & {
      requestPermission: () => Promise<MicPermissionStatus>;
      startCapture: (options?: VoiceCaptureStartOptions | null) => Promise<void>;
      stopCapture: () => void;
    })
  | undefined;

// Prefer the native VoiceIO bridge whenever it is available on iOS.
// Expo Go has no custom native module, so it automatically falls back to expo-audio.
const useNative = Platform.OS === "ios" && Boolean(VoiceIO);

let emitter: NativeEventEmitter | null = null;
if (useNative && VoiceIO) {
  emitter = new NativeEventEmitter(VoiceIO);
}

// --- Expo-Audio fallback (works in Expo Go) ---

const WAV_HEADER_SIZE = 44;
const CHUNK_INTERVAL_MS = 300;

type Recorder = InstanceType<typeof AudioModule.AudioRecorder>;

let currentRecorder: Recorder | null = null;
let chunkTimer: ReturnType<typeof setInterval> | null = null;
let chunkHandler: ((chunkBase64: string) => void) | null = null;
let isCapturing = false;

const RECORDING_OPTIONS: RecordingOptions = {
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  android: {
    outputFormat: "default",
    audioEncoder: "default",
  },
  ios: {
    audioQuality: AudioQuality.MAX,
    outputFormat: IOSOutputFormat.LINEARPCM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: "audio/wav" },
};

async function createRecorder(): Promise<Recorder> {
  const recorder = new AudioModule.AudioRecorder(RECORDING_OPTIONS);
  await recorder.prepareToRecordAsync();
  recorder.record();
  return recorder;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return encodeBase64FromBytes(bytes);
}

async function rotateAndSendChunk() {
  if (!isCapturing || !currentRecorder) return;

  try {
    const prev = currentRecorder;
    await prev.stop();
    const uri = prev.uri;

    // Start new recording immediately after stopping the previous one
    currentRecorder = await createRecorder();

    if (!uri) return;

    const file = new File(uri);
    const buffer = await file.arrayBuffer();
    file.delete();

    if (buffer.byteLength <= WAV_HEADER_SIZE) return;

    const pcmBase64 = arrayBufferToBase64(buffer.slice(WAV_HEADER_SIZE));

    if (chunkHandler && pcmBase64.length > 0) {
      chunkHandler(pcmBase64);
    }
  } catch {
    // Rotation failed — will retry on next interval
  }
}

async function expoRequestPermission(): Promise<MicPermissionStatus> {
  const { granted } = await requestRecordingPermissionsAsync();
  return granted ? "granted" : "denied";
}

async function expoStart() {
  if (isCapturing) return;
  isCapturing = true;

  try {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
      shouldRouteThroughEarpiece: false,
      shouldPlayInBackground: false,
    });

    currentRecorder = await createRecorder();
    chunkTimer = setInterval(rotateAndSendChunk, CHUNK_INTERVAL_MS);
  } catch (err) {
    isCapturing = false;
    if (chunkTimer) {
      clearInterval(chunkTimer);
      chunkTimer = null;
    }
    if (currentRecorder) {
      try {
        await currentRecorder.stop();
      } catch {
        // best effort cleanup
      }
      const uri = currentRecorder.uri;
      if (uri) {
        try {
          new File(uri).delete();
        } catch {
          // best effort cleanup
        }
      }
      currentRecorder = null;
    }
    throw err;
  }
}

async function expoStop() {
  isCapturing = false;
  if (chunkTimer) {
    clearInterval(chunkTimer);
    chunkTimer = null;
  }
  if (currentRecorder) {
    try {
      await currentRecorder.stop();
      const uri = currentRecorder.uri;
      if (uri) new File(uri).delete();
    } catch {
      // already stopped
    }
    currentRecorder = null;
  }
}

// --- Unified interface ---

function buildNoopUnsubscribe() {
  return () => undefined;
}

export const voiceIO = {
  available: true,
  supportsLocalStt: useNative,

  requestPermission: async (): Promise<MicPermissionStatus> => {
    if (useNative && VoiceIO) {
      return VoiceIO.requestPermission();
    }
    return expoRequestPermission();
  },

  start: async (options?: VoiceCaptureStartOptions): Promise<void> => {
    if (useNative && VoiceIO) {
      await VoiceIO.startCapture(options ?? null);
      return;
    }
    await expoStart();
  },

  stop: async (): Promise<void> => {
    if (useNative && VoiceIO) {
      VoiceIO.stopCapture();
      return;
    }
    await expoStop();
  },

  onAudioChunk: (handler: (chunkBase64: string) => void) => {
    if (useNative && emitter) {
      const sub = emitter.addListener("voiceIO.chunk", handler);
      return () => sub.remove();
    }
    chunkHandler = handler;
    return () => {
      chunkHandler = null;
    };
  },

  onLocalSttPartial: (handler: (text: string) => void) => {
    if (!useNative || !emitter) {
      return buildNoopUnsubscribe();
    }

    const sub = emitter.addListener(LOCAL_STT_PARTIAL_EVENT, (payload: unknown) => {
      if (typeof payload === "string") {
        handler(payload);
      }
    });

    return () => sub.remove();
  },

  onLocalSttFinal: (handler: (text: string) => void) => {
    if (!useNative || !emitter) {
      return buildNoopUnsubscribe();
    }

    const sub = emitter.addListener(LOCAL_STT_FINAL_EVENT, (payload: unknown) => {
      if (typeof payload === "string") {
        handler(payload);
      }
    });

    return () => sub.remove();
  },

  onLocalSttError: (handler: (error: LocalSttError) => void) => {
    if (!useNative || !emitter) {
      return buildNoopUnsubscribe();
    }

    const sub = emitter.addListener(LOCAL_STT_ERROR_EVENT, (payload: unknown) => {
      if (payload && typeof payload === "object") {
        const raw = payload as Partial<LocalSttError>;
        handler({
          code: typeof raw.code === "string" ? raw.code : "local_stt_error",
          message: typeof raw.message === "string" ? raw.message : "Local speech recognition failed."
        });
        return;
      }

      handler({
        code: "local_stt_error",
        message: "Local speech recognition failed."
      });
    });

    return () => sub.remove();
  },
};
