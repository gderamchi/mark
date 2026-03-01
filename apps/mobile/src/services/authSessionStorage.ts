import * as SecureStore from "expo-secure-store";

import { debugLog } from "./debugLogger";

const KEY = "mark.auth.session";

export interface PersistedSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export async function persistSession(session: PersistedSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  debugLog("auth-storage", "persist.success", { userId: session.userId });
}

export async function loadSession(): Promise<PersistedSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) {
    debugLog("auth-storage", "load.empty");
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed.accessToken || !parsed.userId || !parsed.email || !parsed.refreshToken) {
      debugLog("auth-storage", "load.invalid_shape");
      return null;
    }
    debugLog("auth-storage", "load.success", { userId: parsed.userId });
    return parsed;
  } catch {
    debugLog("auth-storage", "load.parse_error");
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
  debugLog("auth-storage", "clear.success");
}
