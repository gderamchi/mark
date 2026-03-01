import type { Socket } from "socket.io";

import { extractBearerToken } from "./jwt-auth.guard";

export function getSocketBearerToken(client: Socket): string | null {
  // Prefer the `auth` option (Socket.IO standard)
  const authToken = (client.handshake.auth as { token?: string })?.token;
  if (authToken) {
    return authToken;
  }

  // Fallback to authorization header for backwards compatibility
  const header = client.handshake.headers.authorization;
  if (Array.isArray(header)) {
    return extractBearerToken(header[0]);
  }
  if (typeof header === "string") {
    return extractBearerToken(header);
  }
  return null;
}
