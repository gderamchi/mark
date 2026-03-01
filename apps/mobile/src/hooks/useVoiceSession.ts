import { useEffect, useRef } from "react";
import { Alert, Linking } from "react-native";

import { decodeBase64ToBytes } from "../services/base64";
import { apiClient } from "../services/apiClient";
import { sessionSocket } from "../services/sessionSocket";
import { useAppStore } from "../store/useAppStore";
import { voiceIO } from "./useVoiceIO";

const SILENCE_COMMIT_THRESHOLD = 0.015;
const SILENCE_COMMIT_MS = 900;
const AUDIO_SAMPLE_RATE = 16000;
const LOCAL_FINAL_DEBOUNCE_MS = 450;
const LOCAL_FINAL_DEDUPE_WINDOW_MS = 3000;

function computeRMS(base64Pcm: string): number {
  try {
    const bytes = decodeBase64ToBytes(base64Pcm);
    const len = bytes.length;
    if (len < 2) return 0;

    let sumSquares = 0;
    const sampleCount = Math.floor(len / 2);

    for (let i = 0; i < len - 1; i += 2) {
      // 16-bit signed little-endian
      let sample = bytes[i] | (bytes[i + 1] << 8);
      if (sample >= 0x8000) sample -= 0x10000;
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / sampleCount);
    // Normalize to 0-1 range (16-bit max is 32767)
    return Math.min(1, rms / 32767);
  } catch {
    return 0;
  }
}

function showPermissionDeniedAlert() {
  Alert.alert(
    "Microphone Access Required",
    "Mark needs microphone access to run voice sessions. Please enable it in Settings.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Open Settings", onPress: () => Linking.openSettings() },
    ]
  );
}

export function useVoiceSession(): void {
  const smoothedLevel = useRef(0);
  const lastVoiceAtMs = useRef(0);
  const awaitingCommitAfterVoice = useRef(false);
  const localFinalizer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferedLocalFinal = useRef("");
  const lastLocalFinalHash = useRef("");
  const lastLocalFinalAtMs = useRef(0);
  const hasAccessToken = useAppStore((state) => Boolean(state.accessToken));

  useEffect(() => {
    if (!hasAccessToken) {
      return;
    }

    sessionSocket.connect();
    let cleanupAudio: (() => void) | undefined;
    let cleanupLocalStt: (() => void) | undefined;
    let unmounted = false;
    const setAudioLevel = useAppStore.getState().setAudioLevel;

    void (async () => {
      let useLocalSttFallback = false;

      try {
        const voiceHealth = await apiClient.getVoiceHealth();
        const serverSttLive = voiceHealth.sttConfigured && voiceHealth.mode === "live";
        useLocalSttFallback = !serverSttLive && voiceIO.supportsLocalStt;

        if (!serverSttLive && !voiceIO.supportsLocalStt) {
          sessionSocket.setLocalSttStatus(
            "provider_error",
            "Server STT is in fallback mode and this platform has no on-device STT fallback."
          );
        }
      } catch {
        sessionSocket.setLocalSttStatus(
          "warming_up",
          "Unable to verify voice readiness. Continuing with server transcription."
        );
      }

      try {
        const status = await voiceIO.requestPermission();
        if (status !== "granted") {
          sessionSocket.setLocalSttStatus(
            "mic_inactive",
            "Microphone permission is required for voice input."
          );
          if (!unmounted) {
            showPermissionDeniedAlert();
          }
          return;
        }

        if (useLocalSttFallback) {
          const offPartial = voiceIO.onLocalSttPartial((text) => {
            const trimmed = text.trim();
            if (!trimmed) {
              return;
            }

            const currentState = useAppStore.getState().voiceState;
            if (currentState === "speaking") {
              return;
            }

            useAppStore.getState().setSttPartial(trimmed);
            useAppStore.getState().setVoiceState("listening");
            sessionSocket.setLocalSttStatus("listening", "Listening for your request.");
          });

          const offFinal = voiceIO.onLocalSttFinal((text) => {
            const trimmed = text.trim();
            if (!trimmed) {
              return;
            }

            bufferedLocalFinal.current = trimmed;

            if (localFinalizer.current) {
              clearTimeout(localFinalizer.current);
            }

            localFinalizer.current = setTimeout(() => {
              localFinalizer.current = null;
              const finalText = bufferedLocalFinal.current.trim();
              bufferedLocalFinal.current = "";
              if (!finalText) {
                return;
              }

              const hash = finalText.toLowerCase().replace(/\s+/g, " ").trim();
              const now = Date.now();
              if (
                hash.length > 0 &&
                hash === lastLocalFinalHash.current &&
                now - lastLocalFinalAtMs.current < LOCAL_FINAL_DEDUPE_WINDOW_MS
              ) {
                return;
              }

              lastLocalFinalHash.current = hash;
              lastLocalFinalAtMs.current = now;
              useAppStore.getState().setSttPartial(finalText);
              useAppStore.getState().setVoiceState("thinking");
              sessionSocket.sendTranscript(finalText);
            }, LOCAL_FINAL_DEBOUNCE_MS);
          });

          const offError = voiceIO.onLocalSttError((error) => {
            const message = error.message?.trim() || "On-device speech recognition failed.";
            sessionSocket.setLocalSttStatus("provider_error", message);
          });

          cleanupLocalStt = () => {
            if (localFinalizer.current) {
              clearTimeout(localFinalizer.current);
              localFinalizer.current = null;
            }
            bufferedLocalFinal.current = "";
            offPartial();
            offFinal();
            offError();
          };
        }

        cleanupAudio = voiceIO.onAudioChunk((chunkBase64) => {
          // Don't send audio while the agent is speaking (prevents feedback loop)
          const currentState = useAppStore.getState().voiceState;
          if (currentState === "speaking") return;

          const raw = computeRMS(chunkBase64);
          const now = Date.now();

          // Exponential smoothing for natural feel
          smoothedLevel.current = smoothedLevel.current * 0.3 + raw * 0.7;
          setAudioLevel(smoothedLevel.current);

          if (useLocalSttFallback) {
            return;
          }

          let commit = false;
          if (raw > SILENCE_COMMIT_THRESHOLD) {
            lastVoiceAtMs.current = now;
            awaitingCommitAfterVoice.current = true;
          } else if (
            awaitingCommitAfterVoice.current &&
            lastVoiceAtMs.current > 0 &&
            now - lastVoiceAtMs.current >= SILENCE_COMMIT_MS
          ) {
            commit = true;
            awaitingCommitAfterVoice.current = false;
          }

          sessionSocket.sendAudioChunk(chunkBase64, {
            commit,
            sampleRate: AUDIO_SAMPLE_RATE
          });
        });

        try {
          await voiceIO.start({ enableLocalStt: useLocalSttFallback });
          sessionSocket.setLocalSttStatus(
            "listening",
            useLocalSttFallback
              ? "Listening for your request (on-device transcription)."
              : "Listening for your request."
          );
        } catch (err) {
          cleanupAudio?.();
          cleanupAudio = undefined;
          cleanupLocalStt?.();
          cleanupLocalStt = undefined;
          setAudioLevel(0);
          const code = typeof err === "object" && err && "code" in err ? String((err as { code: string }).code) : "";
          sessionSocket.setLocalSttStatus("mic_inactive", "Microphone capture is unavailable.");
          if (!unmounted) {
            const message =
              code.length > 0
                ? `Failed to start microphone capture (${code}).`
                : "Failed to start microphone capture.";
            Alert.alert("Voice Error", message);
          }
        }
      } catch {
        sessionSocket.setLocalSttStatus("mic_inactive", "Microphone permission request failed.");
        if (!unmounted) {
          Alert.alert("Voice Error", "Failed to request microphone permission.");
        }
      }
    })();

    return () => {
      unmounted = true;
      cleanupAudio?.();
      cleanupLocalStt?.();
      if (localFinalizer.current) {
        clearTimeout(localFinalizer.current);
        localFinalizer.current = null;
      }
      bufferedLocalFinal.current = "";
      void voiceIO.stop().catch(() => undefined);
      sessionSocket.disconnect();
      setAudioLevel(0);
      awaitingCommitAfterVoice.current = false;
      lastVoiceAtMs.current = 0;
    };
  }, [hasAccessToken]);
}
