import React, { useEffect, useState } from "react";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View } from "react-native";

import { AuthScreen } from "../screens/AuthScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { clearSession, loadSession, persistSession } from "../services/authSessionStorage";
import { apiClient } from "../services/apiClient";
import { decodeBase64ToString } from "../services/base64";
import { debugLog } from "../services/debugLogger";
import { useAppStore } from "../store/useAppStore";
import { colors } from "../theme/tokens";

function isTokenExpired(token: string): boolean {
  try {
    const payloadB64 = token.split(".")[1] ?? "";
    const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padLength);
    const payload = JSON.parse(decodeBase64ToString(padded));
    return typeof payload.exp === "number" && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

type RootStackParamList = {
  Home: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  const [hydrating, setHydrating] = useState(true);
  const accessToken = useAppStore((state) => state.accessToken);
  const setAuthSession = useAppStore((state) => state.setAuthSession);

  useEffect(() => {
    const run = async () => {
      try {
        const session = await loadSession();
        debugLog("auth", "hydrate.loaded_session", { exists: Boolean(session) });
        if (session) {
          if (!isTokenExpired(session.accessToken)) {
            debugLog("auth", "hydrate.access_token_valid", { userId: session.userId });
            setAuthSession(session);
          } else if (!isTokenExpired(session.refreshToken)) {
            debugLog("auth", "hydrate.access_expired_refresh_valid", { userId: session.userId });
            try {
              const refreshed = await apiClient.refreshSession(session.refreshToken);
              setAuthSession(refreshed);
              await persistSession(refreshed);
              debugLog("auth", "hydrate.refresh_success", { userId: refreshed.userId });
            } catch {
              debugLog("auth", "hydrate.refresh_failed");
              await clearSession();
            }
          } else {
            debugLog("auth", "hydrate.tokens_expired_clearing_session");
            await clearSession();
          }
        }
      } finally {
        debugLog("auth", "hydrate.complete");
        setHydrating(false);
      }
    };

    void run();
  }, [setAuthSession]);

  if (hydrating) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer
      theme={{
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: colors.background,
          card: colors.surface,
          text: colors.textMain,
          primary: colors.primary,
          border: "rgba(148, 163, 184, 0.12)",
        },
      }}
    >
      {accessToken ? (
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
        </Stack.Navigator>
      ) : (
        <AuthScreen />
      )}
    </NavigationContainer>
  );
};
