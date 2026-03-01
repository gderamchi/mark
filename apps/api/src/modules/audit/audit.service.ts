import { Injectable } from "@nestjs/common";
import { v4 as uuid } from "uuid";

import type { AuditEvent } from "@mark/contracts";

type AuditInput = Omit<AuditEvent, "id" | "createdAt">;

@Injectable()
export class AuditService {
  private readonly events: AuditEvent[] = [];

  addEvent(input: AuditInput): AuditEvent {
    const event: AuditEvent = {
      ...input,
      id: uuid(),
      createdAt: new Date().toISOString()
    };

    this.events.unshift(event);
    if (this.events.length > 2000) {
      this.events.pop();
    }

    return event;
  }

  listByUser(userId: string, limit = 100): AuditEvent[] {
    return this.events.filter((event) => event.userId === userId).slice(0, limit);
  }
}
