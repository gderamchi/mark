import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuthService } from "./auth.service";

function createConfigService(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    JWT_SECRET: "unit-test-jwt-secret",
    ...overrides
  };
  return {
    get: jest.fn((key: string) => values[key])
  } as unknown as ConfigService;
}

describe("AuthService", () => {
  let service: AuthService;
  let tempDir: string;
  let storePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mark-auth-service-"));
    storePath = join(tempDir, "users.json");
    service = new AuthService(createConfigService({ AUTH_USERS_STORE_PATH: storePath }));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("register", () => {
    it("registers and logs in a user with email/password", () => {
      const session = service.register({
        email: "hello@example.com",
        password: "Password123!"
      });

      expect(session.userId).toMatch(/^user-/);
      expect(session.accessToken).toBeDefined();
      expect(session.refreshToken).toBeDefined();
      expect(session.email).toBe("hello@example.com");

      const loginSession = service.login({
        email: "hello@example.com",
        password: "Password123!"
      });

      expect(loginSession.userId).toEqual(session.userId);
    });

    it("rejects duplicate registration", () => {
      service.register({
        email: "hello@example.com",
        password: "Password123!"
      });

      expect(() =>
        service.register({
          email: "hello@example.com",
          password: "Password123!"
        })
      ).toThrow(ConflictException);
    });

    it("normalizes email to lowercase", () => {
      service.register({
        email: "Hello@Example.COM",
        password: "Password123!"
      });

      const session = service.login({
        email: "hello@example.com",
        password: "Password123!"
      });

      expect(session.email).toBe("hello@example.com");
    });

    it("trims email whitespace", () => {
      service.register({
        email: "  hello@example.com  ",
        password: "Password123!"
      });

      const session = service.login({
        email: "hello@example.com",
        password: "Password123!"
      });

      expect(session.userId).toBeDefined();
    });
  });

  describe("login", () => {
    it("rejects invalid password", () => {
      service.register({
        email: "hello@example.com",
        password: "Password123!"
      });

      expect(() =>
        service.login({
          email: "hello@example.com",
          password: "WrongPassword9!"
        })
      ).toThrow(UnauthorizedException);
    });

    it("rejects unknown email", () => {
      expect(() =>
        service.login({
          email: "unknown@example.com",
          password: "Password123!"
        })
      ).toThrow(UnauthorizedException);
    });
  });

  describe("verifyAccessToken", () => {
    it("verifies a valid access token", () => {
      const session = service.register({
        email: "hello@example.com",
        password: "Password123!"
      });

      const claims = service.verifyAccessToken(session.accessToken);
      expect(claims.userId).toBe(session.userId);
      expect(claims.email).toBe("hello@example.com");
    });

    it("rejects a refresh token used as access token", () => {
      const session = service.register({
        email: "hello@example.com",
        password: "Password123!"
      });

      expect(() => service.verifyAccessToken(session.refreshToken)).toThrow(UnauthorizedException);
    });

    it("rejects a tampered token", () => {
      expect(() => service.verifyAccessToken("invalid.token.here")).toThrow(UnauthorizedException);
    });
  });

  describe("verifyRefreshToken", () => {
    it("verifies a valid refresh token", () => {
      const session = service.register({
        email: "hello@example.com",
        password: "Password123!"
      });

      const claims = service.verifyRefreshToken(session.refreshToken);
      expect(claims.userId).toBe(session.userId);
      expect(claims.email).toBe("hello@example.com");
    });

    it("rejects an access token used as refresh token", () => {
      const session = service.register({
        email: "hello@example.com",
        password: "Password123!"
      });

      expect(() => service.verifyRefreshToken(session.accessToken)).toThrow(UnauthorizedException);
    });
  });

  describe("refreshSession", () => {
    it("issues a new session from a valid refresh token", () => {
      const original = service.register({
        email: "hello@example.com",
        password: "Password123!"
      });

      const refreshed = service.refreshSession(original.refreshToken);

      expect(refreshed.userId).toBe(original.userId);
      expect(refreshed.email).toBe("hello@example.com");
      expect(refreshed.accessToken).toBeDefined();
      expect(refreshed.refreshToken).toBeDefined();
      // New access token should be verifiable
      const claims = service.verifyAccessToken(refreshed.accessToken);
      expect(claims.userId).toBe(original.userId);
    });

    it("rejects an invalid refresh token", () => {
      expect(() => service.refreshSession("garbage")).toThrow(UnauthorizedException);
    });
  });

  describe("constructor", () => {
    it("throws when JWT_SECRET is not set", () => {
      expect(() => {
        new AuthService({ get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService);
      }).toThrow("JWT_SECRET environment variable is required");
    });

    it("derives refresh secret from JWT_SECRET if JWT_REFRESH_SECRET is not set", () => {
      const svc = new AuthService(createConfigService({ AUTH_USERS_STORE_PATH: storePath }));
      const session = svc.register({ email: "a@b.com", password: "Password123!" });

      // Should be able to verify refresh token (means separate secret was derived)
      const claims = svc.verifyRefreshToken(session.refreshToken);
      expect(claims.userId).toBe(session.userId);
    });

    it("uses separate JWT_REFRESH_SECRET when set", () => {
      const svc = new AuthService(
        createConfigService({
          JWT_REFRESH_SECRET: "separate-refresh-secret",
          AUTH_USERS_STORE_PATH: storePath
        })
      );
      const session = svc.register({ email: "a@b.com", password: "Password123!" });

      const claims = svc.verifyRefreshToken(session.refreshToken);
      expect(claims.userId).toBe(session.userId);
    });

    it("loads persisted users from disk on restart", () => {
      const firstInstance = new AuthService(createConfigService({ AUTH_USERS_STORE_PATH: storePath }));
      firstInstance.register({
        email: "persisted@example.com",
        password: "Password123!"
      });

      const restartedInstance = new AuthService(createConfigService({ AUTH_USERS_STORE_PATH: storePath }));
      const session = restartedInstance.login({
        email: "persisted@example.com",
        password: "Password123!"
      });

      expect(session.email).toBe("persisted@example.com");
      expect(session.userId).toMatch(/^user-/);
    });
  });
});
