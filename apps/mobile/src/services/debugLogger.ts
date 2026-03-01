import { isDebugLoggingEnabled } from "./runtimeConfig";

export const DEBUG_LOGS_ENABLED = isDebugLoggingEnabled();

export function debugLog(scope: string, event: string, payload?: unknown): void {
  if (!DEBUG_LOGS_ENABLED) {
    return;
  }

  const label = `[debug][${scope}] ${event}`;
  if (typeof payload === "undefined") {
    // eslint-disable-next-line no-console
    console.log(label);
    return;
  }

  // eslint-disable-next-line no-console
  console.log(label, normalizePayload(payload));
}

function normalizePayload(payload: unknown): unknown {
  if (payload instanceof Error) {
    return {
      name: payload.name,
      message: payload.message,
      stack: payload.stack
    };
  }
  return payload;
}
