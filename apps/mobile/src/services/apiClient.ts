import type { AuditEvent, ConnectorView, ImportanceRules } from "@mark/contracts";

import { useAppStore } from "../store/useAppStore";
import { clearSession, persistSession } from "./authSessionStorage";
import { debugLog } from "./debugLogger";
import { getApiBaseUrl } from "./runtimeConfig";

const API_BASE_URL = getApiBaseUrl();

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
};

type RequestOptions = {
  hasRetriedAfterRefresh?: boolean;
  skipAuthRefresh?: boolean;
};

export type VoiceHealth = {
  sttConfigured: boolean;
  ttsConfigured: boolean;
  lastSttErrorAt: string | null;
  mode: "live" | "fallback";
};

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function isAuthRoute(path: string): boolean {
  return path.startsWith("/v1/auth/");
}

async function parseApiError(response: Response): Promise<ApiError> {
  const fallback = `Request failed (${response.status})`;
  let message = fallback;

  const rawBody = await response.text().catch(() => "");
  if (rawBody) {
    try {
      const payload = JSON.parse(rawBody) as {
        error?: string;
        message?: string | string[];
      };

      if (Array.isArray(payload.message) && payload.message.length > 0) {
        message = payload.message.join(", ");
      } else if (typeof payload.message === "string" && payload.message.trim().length > 0) {
        message = payload.message.trim();
      } else if (typeof payload.error === "string" && payload.error.trim().length > 0) {
        message = payload.error.trim();
      }
    } catch {
      const trimmed = rawBody.trim();
      if (trimmed.length > 0) {
        message = trimmed;
      }
    }
  }

  return new ApiError(response.status, message);
}

async function request<T>(path: string, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
  const { hasRetriedAfterRefresh = false, skipAuthRefresh = false } = options;
  const { accessToken } = useAppStore.getState();
  const startedAt = Date.now();
  const method = init?.method ?? "GET";
  debugLog("api", "request.start", {
    method,
    path,
    hasAuthToken: Boolean(accessToken),
    hasRetriedAfterRefresh,
    skipAuthRefresh
  });
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(init?.headers ?? {})
      }
    });
    debugLog("api", "request.response", {
      method,
      path,
      status: response.status,
      durationMs: Date.now() - startedAt
    });
  } catch {
    debugLog("api", "request.network_error", {
      method,
      path,
      durationMs: Date.now() - startedAt
    });
    throw new ApiError(0, "Unable to reach the API server. Check your network and API URL.");
  }

  if (response.status === 401 && !skipAuthRefresh && !isAuthRoute(path) && !hasRetriedAfterRefresh) {
    debugLog("api", "request.unauthorized_refresh_attempt", { method, path });
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return request<T>(path, init, {
        ...options,
        hasRetriedAfterRefresh: true
      });
    }
  }

  if (response.status === 401 && !skipAuthRefresh && !isAuthRoute(path)) {
    debugLog("api", "request.unauthorized_session_cleared", { method, path });
    await clearAuthAndStoredSession();
    throw new ApiError(401, "Session expired");
  }

  if (!response.ok) {
    debugLog("api", "request.error_response", {
      method,
      path,
      status: response.status
    });
    throw await parseApiError(response);
  }

  return (await response.json()) as T;
}

let refreshInFlight: Promise<boolean> | null = null;

async function clearAuthAndStoredSession(): Promise<void> {
  debugLog("api", "auth.clear_session");
  useAppStore.getState().clearAuthSession();
  await clearSession().catch(() => undefined);
}

async function tryRefreshToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const { refreshToken } = useAppStore.getState();
      if (!refreshToken) {
        debugLog("api", "auth.refresh.skipped_missing_refresh_token");
        await clearAuthAndStoredSession();
        return false;
      }
      debugLog("api", "auth.refresh.start");

      const response = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken })
      });

      if (!response.ok) {
        debugLog("api", "auth.refresh.failed", { status: response.status });
        await clearAuthAndStoredSession();
        return false;
      }

      const session = (await response.json()) as AuthSession;
      useAppStore.getState().setAuthSession(session);
      await persistSession(session);
      debugLog("api", "auth.refresh.success", {
        userId: session.userId
      });
      return true;
    } catch (error) {
      debugLog("api", "auth.refresh.exception", error);
      await clearAuthAndStoredSession();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export const apiClient = {
  register: async (email: string, password: string): Promise<AuthSession> => {
    return request<AuthSession>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }, { skipAuthRefresh: true });
  },
  login: async (email: string, password: string): Promise<AuthSession> => {
    return request<AuthSession>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }, { skipAuthRefresh: true });
  },
  refreshSession: async (refreshToken: string): Promise<AuthSession> => {
    return request<AuthSession>(
      "/v1/auth/refresh",
      {
        method: "POST",
        body: JSON.stringify({ refreshToken })
      },
      { skipAuthRefresh: true }
    );
  },
  refreshSessionIfPossible: async (): Promise<boolean> => {
    return tryRefreshToken();
  },
  listConnectors: async (): Promise<ConnectorView[]> => {
    const payload = await request<{ connectors: ConnectorView[] }>("/v1/connectors");
    return payload.connectors;
  },
  connectConnector: async (connectorId: string) => {
    await request(`/v1/connectors/${connectorId}/connect`, { method: "POST" });
  },
  disconnectConnector: async (connectorId: string) => {
    await request(`/v1/connectors/${connectorId}/disconnect`, { method: "POST" });
  },
  fetchRules: async (): Promise<ImportanceRules> => {
    const payload = await request<{ rules: ImportanceRules }>("/v1/rules/importance");
    return payload.rules;
  },
  updateRules: async (rules: Partial<ImportanceRules>): Promise<ImportanceRules> => {
    const payload = await request<{ rules: ImportanceRules }>("/v1/rules/importance", {
      method: "PUT",
      body: JSON.stringify(rules)
    });
    return payload.rules;
  },
  setMemoryOptOut: async (enabled: boolean) => {
    await request("/v1/memory/opt-out", {
      method: "POST",
      body: JSON.stringify({ enabled })
    });
  },
  purgeMemory: async () => {
    await request("/v1/memory/purge", { method: "POST" });
  },
  listAuditEvents: async (): Promise<AuditEvent[]> => {
    const payload = await request<{ events: AuditEvent[] }>("/v1/audit/events?limit=200");
    return payload.events;
  },
  getVoiceHealth: async (): Promise<VoiceHealth> => {
    return request<VoiceHealth>("/health/voice", undefined, { skipAuthRefresh: true });
  }
};
