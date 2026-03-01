const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

export function parseBooleanFlag(value: string | undefined | null): boolean {
  if (!value) {
    return false;
  }

  return TRUTHY_VALUES.has(value.trim().toLowerCase());
}

export function isApiDebugLoggingEnabled(): boolean {
  return parseBooleanFlag(process.env.APP_DEBUG_LOGS);
}
