import React, { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError, apiClient } from "../services/apiClient";
import { persistSession } from "../services/authSessionStorage";
import { debugLog } from "../services/debugLogger";
import { useAppStore } from "../store/useAppStore";
import { colors } from "../theme/tokens";

function getAuthFailureMessage(error: unknown, mode: "login" | "register"): string {
  if (error instanceof ApiError) {
    if (mode === "register" && error.status === 409) {
      return "This email is already registered. Switch to Login or use another email.";
    }
    if (mode === "login" && error.status === 401) {
      return "Invalid email or password.";
    }
    if (error.status === 0) {
      return "Cannot reach the API server. Check that your phone can access your dev machine.";
    }
    if (error.message.trim().length > 0) {
      return error.message;
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Please verify your email/password and try again.";
}

export const AuthScreen: React.FC = () => {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const setAuthSession = useAppStore((state) => state.setAuthSession);

  const submit = async () => {
    if (!email.trim() || password.length < 8) {
      Alert.alert("Invalid input", "Enter a valid email and a password with at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      debugLog("auth", "submit.start", {
        mode,
        email: email.trim().toLowerCase()
      });
      const session =
        mode === "login"
          ? await apiClient.login(email.trim(), password)
          : await apiClient.register(email.trim(), password);

      await persistSession({
        userId: session.userId,
        email: session.email,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken
      });

      setAuthSession({
        userId: session.userId,
        email: session.email,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken
      });
      debugLog("auth", "submit.success", {
        mode,
        userId: session.userId
      });
    } catch (error) {
      debugLog("auth", "submit.error", error);
      Alert.alert("Authentication failed", getAuthFailureMessage(error, mode));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.backdropA} />
      <View style={styles.backdropB} />
      <View style={styles.container}>
        <Text style={styles.title}>Mark Assistant</Text>
        <Text style={styles.subtitle}>Email + Password authentication</Text>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <Pressable
              onPress={() => setMode("login")}
              style={[styles.switchButton, mode === "login" && styles.switchActive]}
            >
              <Text style={[styles.switchLabel, mode === "login" && styles.switchLabelActive]}>Login</Text>
            </Pressable>
            <Pressable
              onPress={() => setMode("register")}
              style={[styles.switchButton, mode === "register" && styles.switchActive]}
            >
              <Text style={[styles.switchLabel, mode === "register" && styles.switchLabelActive]}>
                Register
              </Text>
            </Pressable>
          </View>

          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
          />

          <TextInput
            style={styles.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="Password (8+ chars)"
            placeholderTextColor={colors.textMuted}
          />

          <Pressable style={[styles.submitButton, busy && styles.disabled]} disabled={busy} onPress={submit}>
            {busy ? <ActivityIndicator color="#032e2d" /> : <Text style={styles.submitLabel}>{mode === "login" ? "Login" : "Create account"}</Text>}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background
  },
  backdropA: {
    position: "absolute",
    top: -80,
    right: -90,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "rgba(6, 182, 212, 0.18)"
  },
  backdropB: {
    position: "absolute",
    bottom: -70,
    left: -90,
    width: 320,
    height: 320,
    borderRadius: 170,
    backgroundColor: "rgba(16, 185, 129, 0.14)"
  },
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20
  },
  title: {
    color: colors.textMain,
    fontSize: 34,
    fontWeight: "800"
  },
  subtitle: {
    color: colors.textMuted,
    marginTop: 8,
    marginBottom: 20
  },
  card: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: "rgba(15, 23, 42, 0.88)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)"
  },
  switchRow: {
    flexDirection: "row",
    backgroundColor: "rgba(17, 24, 39, 0.9)",
    borderRadius: 12,
    padding: 4,
    marginBottom: 12
  },
  switchButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 9
  },
  switchActive: {
    backgroundColor: colors.primary
  },
  switchLabel: {
    color: colors.textMuted,
    fontWeight: "700"
  },
  switchLabelActive: {
    color: "#042f2e"
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textMain,
    backgroundColor: "rgba(17, 24, 39, 0.9)"
  },
  submitButton: {
    marginTop: 6,
    borderRadius: 12,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    alignItems: "center"
  },
  submitLabel: {
    color: "#022c22",
    fontWeight: "800"
  },
  disabled: {
    opacity: 0.6
  }
});
