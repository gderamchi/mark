import Constants from "expo-constants";

export function getApiBaseUrl(): string {
  const expoExtra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
  const fromExpo = expoExtra?.apiBaseUrl;
  if (typeof fromExpo === "string" && fromExpo.length > 0) {
    return stripTrailingSlash(fromExpo);
  }

  const host = getExpoHost();
  if (host) {
    return `http://${host}:4000`;
  }

  return "http://localhost:4000";
}

export function getSocketBaseUrl(): string {
  return getApiBaseUrl();
}

export function isDebugLoggingEnabled(): boolean {
  const expoExtra = Constants.expoConfig?.extra as { debugLogs?: string | boolean } | undefined;
  return parseBooleanFlag(expoExtra?.debugLogs);
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseBooleanFlag(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function getExpoHost(): string | null {
  const constants = Constants as unknown as {
    expoGoConfig?: { debuggerHost?: string };
    manifest?: { debuggerHost?: string };
    manifest2?: {
      extra?: {
        expoGo?: { debuggerHost?: string };
        expoClient?: { hostUri?: string };
      };
    };
  };

  const candidates = [
    Constants.expoConfig?.hostUri,
    constants.expoGoConfig?.debuggerHost,
    constants.manifest?.debuggerHost,
    constants.manifest2?.extra?.expoGo?.debuggerHost,
    constants.manifest2?.extra?.expoClient?.hostUri
  ];

  for (const candidate of candidates) {
    const host = parseHost(candidate);
    if (host) {
      return host;
    }
  }

  return null;
}

function parseHost(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const withoutScheme = normalized.replace(/^\w+:\/\//, "");
  const withoutPath = withoutScheme.split("/")[0] ?? "";
  const withoutAuth = withoutPath.includes("@") ? (withoutPath.split("@").pop() ?? "") : withoutPath;
  if (!withoutAuth) {
    return null;
  }

  const host = withoutAuth.split(":")[0];
  return host && host.length > 0 ? host : null;
}
