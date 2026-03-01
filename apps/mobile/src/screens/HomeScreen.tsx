import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";

import { AudioWaveform, BorderGlow, SwipeableNotificationList } from "@mark/ui";

import { useVoiceSession } from "../hooks/useVoiceSession";
import { useNotifications } from "../hooks/useNotifications";
import { useAppStore } from "../store/useAppStore";

type RootStackParamList = {
  Home: undefined;
  Settings: undefined;
};

export const HomeScreen: React.FC = () => {
  useVoiceSession();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const notifications = useNotifications();

  const { voiceState, sttPartial, sttStatus, audioLevel, latestReply } = useAppStore(
    useShallow((s) => ({
      voiceState: s.voiceState,
      sttPartial: s.sttPartial,
      sttStatus: s.sttStatus,
      audioLevel: s.audioLevel,
      latestReply: s.latestReply,
    }))
  );

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
  }, []);

  const visibleNotifications = notifications.filter(
    (n) => !dismissedIds.has(n.id)
  );

  const isListening = voiceState === "listening";
  const isSpeaking = voiceState === "speaking";
  const isThinking = voiceState === "thinking";
  const diagnosticMessage =
    sttStatus && sttStatus.code !== "listening" ? sttStatus.message : null;
  const diagnosticTone =
    sttStatus?.code === "provider_error" || sttStatus?.code === "mic_inactive"
      ? "error"
      : "warning";

  return (
    <BorderGlow state={voiceState}>
      <SafeAreaView style={styles.safeArea}>
        {/* Top bar — gear only, top-right */}
        <View style={styles.topBar}>
          <View style={{ width: 40 }} />
          <Pressable
            onPress={() => navigation.navigate("Settings")}
            hitSlop={14}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.iconPressed,
            ]}
          >
            <Ionicons
              name="settings-outline"
              size={22}
              color="rgba(255,255,255,0.5)"
            />
          </Pressable>
        </View>

        {diagnosticMessage ? (
          <View
            style={[
              styles.diagnosticsBanner,
              diagnosticTone === "error"
                ? styles.diagnosticsBannerError
                : styles.diagnosticsBannerWarning,
            ]}
          >
            <Text
              style={[
                styles.diagnosticsText,
                diagnosticTone === "error"
                  ? styles.diagnosticsTextError
                  : styles.diagnosticsTextWarning,
              ]}
              numberOfLines={2}
            >
              {diagnosticMessage}
            </Text>
          </View>
        ) : null}

        {/* Center — voice session */}
        <View style={styles.center}>
          {/* Waveform visualizer */}
          <AudioWaveform
            level={audioLevel}
            state={voiceState}
            barCount={5}
          />

          {/* Live transcription while listening/thinking */}
          {(isListening || isThinking) && (
            <Text
              style={[
                styles.transcription,
                !sttPartial && isListening && styles.transcriptionPlaceholder,
              ]}
              numberOfLines={4}
            >
              {sttPartial || (isListening ? "Listening..." : "Thinking...")}
            </Text>
          )}

          {/* AI reply */}
          {(isSpeaking || isThinking) && (
            <Text style={styles.replyText} numberOfLines={6}>
              {isThinking ? "Thinking..." : latestReply || "Speaking..."}
            </Text>
          )}

          {/* Idle — reconnecting hint */}
          {voiceState === "idle" && (
            <Text style={styles.statusLabel}>Connecting...</Text>
          )}
        </View>

        {/* Swipeable notification list */}
        <SwipeableNotificationList
          notifications={visibleNotifications}
          onDismiss={handleDismiss}
        />
      </SafeAreaView>
    </BorderGlow>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 0,
  },
  iconButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  iconPressed: {
    opacity: 0.5,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  diagnosticsBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1
  },
  diagnosticsBannerWarning: {
    backgroundColor: "rgba(245,158,11,0.14)",
    borderColor: "rgba(245,158,11,0.28)"
  },
  diagnosticsBannerError: {
    backgroundColor: "rgba(248,113,113,0.16)",
    borderColor: "rgba(248,113,113,0.28)"
  },
  diagnosticsText: {
    textAlign: "center",
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18
  },
  diagnosticsTextWarning: {
    color: "rgba(255,241,209,0.95)"
  },
  diagnosticsTextError: {
    color: "rgba(255,228,228,0.95)"
  },
  listeningContainer: {
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingHorizontal: 32,
  },
  transcription: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 20,
    fontWeight: "400",
    textAlign: "center",
    lineHeight: 28,
  },
  transcriptionPlaceholder: {
    color: "rgba(255,255,255,0.35)",
    fontWeight: "300",
  },
  statusLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 17,
    fontWeight: "300",
    letterSpacing: 0.5,
  },
  replyText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 18,
    fontWeight: "400",
    textAlign: "center",
    lineHeight: 26,
    paddingHorizontal: 32,
    marginTop: 16,
  },
});
