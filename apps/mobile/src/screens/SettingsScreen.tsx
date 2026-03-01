import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";

import { apiClient } from "../services/apiClient";
import { clearSession } from "../services/authSessionStorage";
import { sessionSocket } from "../services/sessionSocket";
import { useAppStore } from "../store/useAppStore";
import { colors } from "../theme/tokens";

type RootStackParamList = {
  Home: undefined;
  Settings: undefined;
};

const CONNECTOR_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  gmail: "mail",
  slack: "chatbubbles",
  discord: "game-controller",
  github: "logo-github",
  notion: "document-text",
};

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { email, connectors, setConnectors, auditEvents, setAuditEvents, clearAuthSession } =
    useAppStore(
      useShallow((state) => ({
        email: state.email,
        connectors: state.connectors,
        setConnectors: state.setConnectors,
        auditEvents: state.auditEvents,
        setAuditEvents: state.setAuditEvents,
        clearAuthSession: state.clearAuthSession,
      }))
    );

  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [optOut, setOptOut] = useState(false);
  const [vipDomain, setVipDomain] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshConnectors = async (showError = true) => {
    setConnectorsLoading(true);
    try {
      const data = await apiClient.listConnectors();
      setConnectors(data);
      return true;
    } catch {
      if (showError) {
        Alert.alert("Error", "Failed to load connectors.");
      }
      return false;
    } finally {
      setConnectorsLoading(false);
    }
  };

  const refreshAudit = async (showError = true) => {
    setAuditLoading(true);
    try {
      const events = await apiClient.listAuditEvents();
      setAuditEvents(events);
      return true;
    } catch {
      if (showError) {
        Alert.alert("Error", "Failed to load audit trail.");
      }
      return false;
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      await refreshConnectors(true);
      await refreshAudit(true);
    })();
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Custom header with back chevron */}
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.textMain} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Account ─── */}
        <Text style={styles.sectionHeader}>Account</Text>
        <View style={styles.card}>
          <View style={styles.accountRow}>
            <View style={styles.emailIconWrap}>
              <Ionicons name="person" size={18} color={colors.primary} />
            </View>
            <Text style={styles.emailText}>{email ?? "Not signed in"}</Text>
          </View>
          <Pressable
            style={styles.logoutButton}
            onPress={async () => {
              sessionSocket.disconnect();
              try {
                await clearSession();
              } catch {
                Alert.alert("Error", "Failed to clear local session storage.");
              } finally {
                clearAuthSession();
              }
            }}
          >
            <Text style={styles.logoutLabel}>Log out</Text>
          </Pressable>
        </View>

        {/* ─── Connections ─── */}
        <Text style={styles.sectionHeader}>Connections</Text>
        {connectorsLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : null}
        {connectors.map((connector) => (
          <View key={connector.id} style={styles.connectorItem}>
            <View style={styles.connectorLeft}>
              <View
                style={[
                  styles.connectorIcon,
                  connector.connected ? styles.iconConnected : styles.iconDisconnected,
                ]}
              >
                <Ionicons
                  name={CONNECTOR_ICONS[connector.id] ?? "extension-puzzle"}
                  size={18}
                  color={connector.connected ? colors.primary : colors.textMuted}
                />
              </View>
              <View>
                <Text style={styles.connectorName}>{connector.name}</Text>
                <Text style={styles.connectorMeta}>
                  {connector.category} · {connector.writeMode}
                </Text>
              </View>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.connectButton,
                connector.connected ? styles.disconnectBg : styles.connectBg,
                pressed && styles.buttonPressed,
              ]}
              onPress={async () => {
                setBusy(true);
                try {
                  if (connector.connected) {
                    await apiClient.disconnectConnector(connector.id);
                  } else {
                    await apiClient.connectConnector(connector.id);
                  }
                  await refreshConnectors(false);
                } catch {
                  Alert.alert(
                    "Connection Error",
                    `Failed to ${connector.connected ? "disconnect" : "connect"} ${connector.name}.`
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Text
                style={[
                  styles.connectLabel,
                  connector.connected ? styles.disconnectText : styles.connectText,
                ]}
              >
                {connector.connected ? "Disconnect" : "Connect"}
              </Text>
            </Pressable>
          </View>
        ))}

        {/* ─── Memory & Safety ─── */}
        <Text style={styles.sectionHeader}>Memory & Safety</Text>
        <View style={styles.card}>
          <View style={styles.memoryRow}>
            <Text style={styles.memoryLabel}>Persist memory</Text>
            <Switch
              value={!optOut}
              onValueChange={async (enabled) => {
                setBusy(true);
                const previousOptOut = optOut;
                const nextOptOut = !enabled;
                setOptOut(nextOptOut);
                try {
                  await apiClient.setMemoryOptOut(nextOptOut);
                } catch {
                  setOptOut(previousOptOut);
                  Alert.alert("Error", "Failed to update memory preference.");
                } finally {
                  setBusy(false);
                }
              }}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.memoryLabel}>VIP domain rule</Text>
          <TextInput
            value={vipDomain}
            onChangeText={setVipDomain}
            placeholder="important-client.com"
            placeholderTextColor={colors.textMuted}
            style={styles.textInput}
          />
          <Pressable
            style={styles.saveRuleButton}
            onPress={async () => {
              if (!vipDomain.trim()) return;
              setBusy(true);
              try {
                await apiClient.updateRules({
                  vipDomains: [vipDomain.trim().toLowerCase()],
                });
                Alert.alert("Saved", "VIP domain rule updated");
                setVipDomain("");
              } catch {
                Alert.alert("Error", "Failed to update VIP domain rule.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Text style={styles.saveRuleLabel}>Save rule</Text>
          </Pressable>
        </View>

        <Pressable
          style={[styles.purgeButton, busy && styles.disabled]}
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await apiClient.purgeMemory();
              Alert.alert("Done", "Memory purged");
            } catch {
              Alert.alert("Error", "Failed to purge memory.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Text style={styles.purgeLabel}>Purge memory now</Text>
        </Pressable>

        {/* ─── Audit ─── */}
        <Text style={styles.sectionHeader}>Audit Trail</Text>
        {auditLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : null}
        {auditEvents.length === 0 ? (
          <Text style={styles.emptyText}>No audit entries yet.</Text>
        ) : (
          auditEvents.slice(0, 20).map((event) => (
            <View key={event.id} style={styles.auditItem}>
              <View style={styles.auditHeader}>
                <Text style={styles.auditType}>{event.type}</Text>
                <Text style={styles.auditTime}>
                  {new Date(event.createdAt).toLocaleString()}
                </Text>
              </View>
              <Text style={styles.auditDetail}>{event.detail}</Text>
              <Text style={styles.auditStatus}>{event.status}</Text>
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backButton: {
    padding: 8,
    borderRadius: 12,
  },
  backPressed: {
    opacity: 0.6,
  },
  headerTitle: {
    color: colors.textMain,
    fontSize: 18,
    fontWeight: "700",
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 40,
  },
  sectionHeader: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 10,
  },
  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
    padding: 14,
    marginBottom: 10,
  },
  // Account
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  emailIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(6, 182, 212, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  emailText: {
    color: colors.textMain,
    fontSize: 15,
    fontWeight: "600",
  },
  logoutButton: {
    borderRadius: 10,
    paddingVertical: 10,
    borderColor: "rgba(148, 163, 184, 0.35)",
    borderWidth: 1,
    alignItems: "center",
  },
  logoutLabel: {
    color: colors.textMuted,
    fontWeight: "700",
  },
  // Connectors
  loader: {
    marginBottom: 12,
  },
  connectorItem: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
    padding: 14,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  connectorLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  connectorIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  iconConnected: {
    backgroundColor: "rgba(6, 182, 212, 0.12)",
  },
  iconDisconnected: {
    backgroundColor: "rgba(148, 163, 184, 0.08)",
  },
  connectorName: {
    color: colors.textMain,
    fontWeight: "700",
    fontSize: 15,
  },
  connectorMeta: {
    color: colors.textMuted,
    marginTop: 2,
    fontSize: 12,
  },
  connectButton: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  connectBg: {
    backgroundColor: colors.success,
  },
  disconnectBg: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
  },
  buttonPressed: {
    opacity: 0.7,
  },
  connectLabel: {
    fontWeight: "700",
    fontSize: 13,
  },
  connectText: {
    color: "#030712",
  },
  disconnectText: {
    color: colors.error,
  },
  // Memory
  memoryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  memoryLabel: {
    color: colors.textMain,
    fontWeight: "700",
    marginBottom: 8,
  },
  textInput: {
    borderRadius: 10,
    borderColor: "rgba(148, 163, 184, 0.2)",
    borderWidth: 1,
    color: colors.textMain,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  saveRuleButton: {
    backgroundColor: colors.primary,
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  saveRuleLabel: {
    color: "#022c22",
    fontWeight: "700",
  },
  purgeButton: {
    marginTop: 4,
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: colors.error,
    alignItems: "center",
    marginBottom: 10,
  },
  disabled: {
    opacity: 0.6,
  },
  purgeLabel: {
    color: "#fff",
    fontWeight: "700",
  },
  // Audit
  emptyText: {
    color: colors.textMuted,
    marginTop: 4,
  },
  auditItem: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
    marginBottom: 8,
  },
  auditHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  auditType: {
    color: colors.textMain,
    fontWeight: "700",
    fontSize: 14,
  },
  auditTime: {
    color: colors.textMuted,
    fontSize: 11,
  },
  auditDetail: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 4,
  },
  auditStatus: {
    color: colors.textMuted,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
