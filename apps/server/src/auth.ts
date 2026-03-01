import type { Request } from "express";
import { createClient, type User } from "@supabase/supabase-js";

import type { EnvConfig } from "./env.js";

export type AuthenticatedUser = {
  id: string;
  email: string | null;
  composioUserId: string;
};

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

export class AuthService {
  private readonly adminClient;

  constructor(private readonly env: EnvConfig) {
    if (env.supabaseUrl && env.supabaseServiceRoleKey) {
      this.adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
    } else {
      this.adminClient = null;
    }
  }

  isConfigured(): boolean {
    return Boolean(this.adminClient);
  }

  async verifyAccessToken(accessToken: string | null | undefined): Promise<AuthenticatedUser> {
    if (!this.adminClient) {
      throw new AuthError(
        "Authentication is unavailable because SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.",
        503
      );
    }

    if (!accessToken) {
      throw new AuthError("Missing bearer token.", 401);
    }

    const { data, error } = await this.adminClient.auth.getUser(accessToken);

    if (error || !data.user) {
      throw new AuthError("Invalid or expired token.", 401);
    }

    return mapUser(data.user);
  }

  async requireRequestUser(req: Request): Promise<AuthenticatedUser> {
    const token = getBearerToken(req.header("authorization"));
    return this.verifyAccessToken(token);
  }
}

function mapUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email ?? null,
    composioUserId: `supabase:${user.id}`
  };
}

export function getBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }
  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}
