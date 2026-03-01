import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Mark Assistant",
  slug: "mark-assistant",
  scheme: "mark",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  ios: {
    supportsTablet: false,
    bundleIdentifier: "io.mark.assistant",
    infoPlist: {
      NSMicrophoneUsageDescription:
        "Mark uses your microphone to run real-time voice assistant sessions.",
      NSSpeechRecognitionUsageDescription:
        "Mark uses speech recognition to transcribe your voice commands."
    }
  },
  android: {
    package: "io.mark.assistant"
  },
  plugins: ["expo-dev-client", "expo-secure-store", "expo-audio", "./plugins/withVoiceIO"],
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
    debugLogs: process.env.EXPO_PUBLIC_DEBUG_LOGS ?? "false"
  }
};

export default config;
