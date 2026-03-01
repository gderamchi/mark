import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { File, Paths } from "expo-file-system";

import { decodeBase64ToBytes } from "./base64";
import { debugLog } from "./debugLogger";

let initialized = false;

async function ensureAudioMode() {
  if (initialized) return;
  initialized = true;
  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: "duckOthers",
    allowsRecording: true,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  });
}

/**
 * Plays a base64-encoded MP3 audio chunk from ElevenLabs TTS.
 * Writes to a temp file, plays it, then cleans up.
 */
export async function playTtsAudio(chunkBase64: string): Promise<void> {
  await ensureAudioMode();
  const startedAt = Date.now();

  // Write base64 MP3 to a temp file
  const fileName = `tts-${Date.now()}.mp3`;
  const file = new File(Paths.cache, fileName);

  // Decode base64 to bytes and write
  const bytes = decodeBase64ToBytes(chunkBase64);
  file.write(bytes);
  debugLog("tts", "playback.start", {
    fileName,
    bytes: bytes.length
  });

  const player = createAudioPlayer(file.uri);

  return new Promise<void>((resolve) => {
    const sub = player.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) {
        sub.remove();
        player.remove();
        try { file.delete(); } catch {}
        debugLog("tts", "playback.complete", {
          durationMs: Date.now() - startedAt
        });
        resolve();
      }
    });

    // Timeout fallback in case playback never finishes
    const timeout = setTimeout(() => {
      sub.remove();
      player.remove();
      try { file.delete(); } catch {}
      debugLog("tts", "playback.timeout", {
        durationMs: Date.now() - startedAt
      });
      resolve();
    }, 30000);

    player.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) {
        clearTimeout(timeout);
      }
    });

    player.play();
  });
}
