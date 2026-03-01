import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface BackboardRecord {
  optedOut: boolean;
  profileNotes: string[];
}

/**
 * Backboard adapter — manages user profile memory.
 *
 * When BACKBOARD_API_KEY + BACKBOARD_BASE_URL are set, persists data
 * to the Backboard external API. Otherwise falls back to in-memory
 * storage (data lost on restart).
 */
@Injectable()
export class BackboardAdapter {
  private readonly logger = new Logger(BackboardAdapter.name);
  private readonly apiKey: string | null;
  private readonly baseUrl: string | null;

  // In-memory fallback
  private readonly records = new Map<string, BackboardRecord>();

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>("BACKBOARD_API_KEY") ?? null;
    this.baseUrl = this.configService.get<string>("BACKBOARD_BASE_URL") ?? null;

    if (!this.apiKey || !this.baseUrl) {
      this.logger.warn("BACKBOARD_API_KEY/BACKBOARD_BASE_URL not set — using in-memory storage (data will be lost on restart)");
    }
  }

  private get isConfigured(): boolean {
    return this.apiKey !== null && this.baseUrl !== null;
  }

  async getRecord(userId: string): Promise<BackboardRecord> {
    if (!this.isConfigured) {
      return this.records.get(userId) ?? { optedOut: false, profileNotes: [] };
    }

    try {
      const response = await fetch(`${this.baseUrl}/users/${encodeURIComponent(userId)}/profile`, {
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { optedOut: false, profileNotes: [] };
        }
        this.logger.error(`Backboard getRecord error: ${response.status}`);
        return this.records.get(userId) ?? { optedOut: false, profileNotes: [] };
      }

      return (await response.json()) as BackboardRecord;
    } catch (err) {
      this.logger.error("Backboard getRecord error", err);
      return this.records.get(userId) ?? { optedOut: false, profileNotes: [] };
    }
  }

  async setOptOut(userId: string, enabled: boolean): Promise<BackboardRecord> {
    const current = await this.getRecord(userId);
    const next: BackboardRecord = { ...current, optedOut: enabled };

    if (!this.isConfigured) {
      this.records.set(userId, next);
      return next;
    }

    try {
      await fetch(`${this.baseUrl}/users/${encodeURIComponent(userId)}/profile`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(next)
      });
    } catch (err) {
      this.logger.error("Backboard setOptOut error", err);
    }

    // Also update local cache
    this.records.set(userId, next);
    return next;
  }

  async addProfileNote(userId: string, note: string): Promise<BackboardRecord> {
    const current = await this.getRecord(userId);
    if (current.optedOut) {
      return current;
    }

    const next: BackboardRecord = {
      ...current,
      profileNotes: [...current.profileNotes, note].slice(-100)
    };

    if (!this.isConfigured) {
      this.records.set(userId, next);
      return next;
    }

    try {
      await fetch(`${this.baseUrl}/users/${encodeURIComponent(userId)}/profile`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(next)
      });
    } catch (err) {
      this.logger.error("Backboard addProfileNote error", err);
    }

    this.records.set(userId, next);
    return next;
  }

  async purge(userId: string): Promise<void> {
    this.records.delete(userId);

    if (!this.isConfigured) {
      return;
    }

    try {
      await fetch(`${this.baseUrl}/users/${encodeURIComponent(userId)}/profile`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${this.apiKey}`
        }
      });
    } catch (err) {
      this.logger.error("Backboard purge error", err);
    }
  }
}
