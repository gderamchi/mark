import { UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { AuthService } from "@/modules/auth/auth.service";

import { extractBearerToken, JwtAuthGuard } from "./jwt-auth.guard";

function createMockContext(overrides: {
  type?: string;
  isPublic?: boolean;
  authorization?: string;
} = {}) {
  const { type = "http", isPublic = false, authorization } = overrides;
  const request = {
    headers: { authorization } as Record<string, string | undefined>,
    user: undefined as { userId: string; email: string } | undefined
  };

  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    getType: jest.fn().mockReturnValue(type),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request)
    }),
    _request: request,
    _isPublic: isPublic
  };
}

describe("JwtAuthGuard", () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;
  let authService: Partial<AuthService>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn()
    } as any;
    authService = {
      verifyAccessToken: jest.fn().mockReturnValue({ userId: "u1", email: "a@b.com" })
    };
    guard = new JwtAuthGuard(reflector as Reflector, authService as AuthService);
  });

  it("allows public routes", () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    const ctx = createMockContext({ isPublic: true });

    expect(guard.canActivate(ctx as any)).toBe(true);
  });

  it("allows WebSocket contexts (handled by gateway)", () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    const ctx = createMockContext({ type: "ws" });

    expect(guard.canActivate(ctx as any)).toBe(true);
  });

  it("allows non-HTTP contexts", () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    const ctx = createMockContext({ type: "rpc" });

    expect(guard.canActivate(ctx as any)).toBe(true);
  });

  it("throws when no authorization header", () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    const ctx = createMockContext({ authorization: undefined });

    expect(() => guard.canActivate(ctx as any)).toThrow(UnauthorizedException);
  });

  it("throws for malformed authorization header", () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    const ctx = createMockContext({ authorization: "InvalidFormat" });

    expect(() => guard.canActivate(ctx as any)).toThrow(UnauthorizedException);
  });

  it("verifies valid bearer token and attaches user", () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    const ctx = createMockContext({ authorization: "Bearer valid-token" });

    const result = guard.canActivate(ctx as any);
    expect(result).toBe(true);
    expect(authService.verifyAccessToken).toHaveBeenCalledWith("valid-token");
  });

  it("throws when authService rejects the token", () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    (authService.verifyAccessToken as jest.Mock).mockImplementation(() => {
      throw new UnauthorizedException("Invalid");
    });
    const ctx = createMockContext({ authorization: "Bearer bad-token" });

    expect(() => guard.canActivate(ctx as any)).toThrow(UnauthorizedException);
  });
});

describe("extractBearerToken", () => {
  it("extracts token from valid Bearer header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("is case-insensitive for Bearer prefix", () => {
    expect(extractBearerToken("bearer abc123")).toBe("abc123");
  });

  it("returns null for missing header", () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it("returns null for non-Bearer prefix", () => {
    expect(extractBearerToken("Basic abc123")).toBeNull();
  });

  it("returns null for header with no token", () => {
    expect(extractBearerToken("Bearer")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractBearerToken("")).toBeNull();
  });
});
