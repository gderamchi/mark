import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { sign, verify } from "jsonwebtoken";
import { v4 as uuid } from "uuid";

import { isApiDebugLoggingEnabled } from "@/common/debug-logging";

import type { LoginDto, RegisterDto } from "./auth.dto";

interface UserRecord {
  userId: string;
  email: string;
  name?: string;
  passwordHash: string;
}

interface PersistedUsersPayload {
  users: UserRecord[];
}

interface SessionPayload {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
}

interface AccessClaims {
  userId: string;
  email: string;
}

type JwtPayload = {
  sub: string;
  email: string;
  typ: "access" | "refresh";
  iat: number;
  exp: number;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly debugLogsEnabled = isApiDebugLoggingEnabled();
  private readonly usersByEmail = new Map<string, UserRecord>();
  private readonly jwtSecret: string;
  private readonly jwtRefreshSecret: string;
  private readonly usersStoreFilePath: string;

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>("JWT_SECRET");
    if (!secret) {
      throw new Error("JWT_SECRET environment variable is required");
    }
    this.jwtSecret = secret;
    this.jwtRefreshSecret = this.configService.get<string>("JWT_REFRESH_SECRET") ?? `${secret}:refresh`;
    this.usersStoreFilePath = resolve(
      this.configService.get<string>("AUTH_USERS_STORE_PATH") ?? ".data/auth-users.json"
    );
    this.loadUsersFromDisk();
  }

  register(payload: RegisterDto): SessionPayload {
    const email = payload.email.toLowerCase().trim();
    if (this.usersByEmail.has(email)) {
      throw new ConflictException("Email already registered");
    }

    const user: UserRecord = {
      userId: `user-${uuid()}`,
      email,
      name: payload.name?.trim(),
      passwordHash: this.hashPassword(payload.password)
    };

    this.usersByEmail.set(email, user);
    try {
      this.persistUsersToDisk();
    } catch (error) {
      this.usersByEmail.delete(email);
      this.logger.error("Failed to persist registered user", error);
      throw new InternalServerErrorException("Unable to create account right now");
    }
    this.debugTrace("auth.register.success", {
      userId: user.userId,
      email
    });
    return this.issueSession(user);
  }

  login(payload: LoginDto): SessionPayload {
    const email = payload.email.toLowerCase().trim();
    const user = this.usersByEmail.get(email);
    if (!user || !this.verifyPassword(payload.password, user.passwordHash)) {
      this.debugTrace("auth.login.failed", {
        email
      });
      throw new UnauthorizedException("Invalid email or password");
    }

    this.debugTrace("auth.login.success", {
      userId: user.userId,
      email
    });
    return this.issueSession(user);
  }

  verifyAccessToken(token: string): AccessClaims {
    try {
      const claims = verify(token, this.jwtSecret, { algorithms: ["HS256"] }) as JwtPayload;
      if (claims.typ !== "access") {
        throw new UnauthorizedException("Invalid access token type");
      }

      return {
        userId: claims.sub,
        email: claims.email
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }

  verifyRefreshToken(token: string): AccessClaims {
    try {
      const claims = verify(token, this.jwtRefreshSecret, { algorithms: ["HS256"] }) as JwtPayload;
      if (claims.typ !== "refresh") {
        throw new UnauthorizedException("Invalid refresh token type");
      }

      return {
        userId: claims.sub,
        email: claims.email
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
  }

  refreshSession(refreshToken: string): SessionPayload {
    const claims = this.verifyRefreshToken(refreshToken);
    const user = this.findUserById(claims.userId);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }
    this.debugTrace("auth.refresh.success", {
      userId: user.userId,
      email: user.email
    });
    return this.issueSession(user);
  }

  private issueSession(user: UserRecord): SessionPayload {
    const accessToken = sign(
      {
        sub: user.userId,
        email: user.email,
        typ: "access"
      },
      this.jwtSecret,
      { algorithm: "HS256", expiresIn: "20m" }
    );

    const refreshToken = sign(
      {
        sub: user.userId,
        email: user.email,
        typ: "refresh"
      },
      this.jwtRefreshSecret,
      { algorithm: "HS256", expiresIn: "30d" }
    );

    return {
      accessToken,
      refreshToken,
      userId: user.userId,
      email: user.email
    };
  }

  private findUserById(userId: string): UserRecord | undefined {
    for (const user of this.usersByEmail.values()) {
      if (user.userId === userId) return user;
    }
    return undefined;
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const derived = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${derived}`;
  }

  private verifyPassword(password: string, passwordHash: string): boolean {
    const [salt, stored] = passwordHash.split(":");
    if (!salt || !stored) {
      return false;
    }

    let storedBuffer: Buffer;
    let derivedBuffer: Buffer;
    try {
      storedBuffer = Buffer.from(stored, "hex");
      derivedBuffer = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
    } catch {
      return false;
    }

    if (storedBuffer.length !== derivedBuffer.length) {
      return false;
    }

    return timingSafeEqual(storedBuffer, derivedBuffer);
  }

  private loadUsersFromDisk(): void {
    if (!existsSync(this.usersStoreFilePath)) {
      this.logger.log(`Auth store file not found at ${this.usersStoreFilePath}; starting with empty user store`);
      return;
    }

    try {
      const raw = readFileSync(this.usersStoreFilePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedUsersPayload;
      if (!parsed || !Array.isArray(parsed.users)) {
        this.logger.warn(`Ignoring invalid auth store payload from ${this.usersStoreFilePath}`);
        return;
      }

      this.usersByEmail.clear();
      for (const user of parsed.users) {
        if (!this.isValidUserRecord(user)) {
          continue;
        }
        this.usersByEmail.set(user.email, user);
      }

      this.logger.log(`Loaded ${this.usersByEmail.size} auth user(s) from ${this.usersStoreFilePath}`);
    } catch (error) {
      this.logger.error(`Failed to read auth store file ${this.usersStoreFilePath}`, error);
    }
  }

  private persistUsersToDisk(): void {
    mkdirSync(dirname(this.usersStoreFilePath), { recursive: true });
    const payload: PersistedUsersPayload = {
      users: [...this.usersByEmail.values()]
    };
    writeFileSync(this.usersStoreFilePath, JSON.stringify(payload, null, 2), "utf8");
  }

  private isValidUserRecord(value: unknown): value is UserRecord {
    if (!value || typeof value !== "object") {
      return false;
    }

    const user = value as Partial<UserRecord>;
    return (
      typeof user.userId === "string" &&
      typeof user.email === "string" &&
      typeof user.passwordHash === "string" &&
      (typeof user.name === "string" || typeof user.name === "undefined")
    );
  }

  private debugTrace(event: string, payload: Record<string, unknown>): void {
    if (!this.debugLogsEnabled) {
      return;
    }
    this.logger.debug(`[debug] ${event} ${JSON.stringify(payload)}`);
  }
}
