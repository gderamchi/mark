import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { AuthService } from "@/modules/auth/auth.service";

import { IS_PUBLIC_KEY } from "./public.decorator";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    if (context.getType() === "ws") {
      // WebSocket auth is handled by the gateway middleware
      return true;
    }

    if (context.getType() !== "http") {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: { userId: string; email: string };
    }>();

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const claims = this.authService.verifyAccessToken(token);
    request.user = {
      userId: claims.userId,
      email: claims.email
    };

    return true;
  }
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [prefix, token] = header.split(" ");
  if (prefix?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}
