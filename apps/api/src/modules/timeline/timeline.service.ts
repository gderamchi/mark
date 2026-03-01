import { Injectable } from "@nestjs/common";
import { v4 as uuid } from "uuid";

import type { TimelineCard } from "@mark/contracts";

@Injectable()
export class TimelineService {
  private readonly cardsByUser = new Map<string, TimelineCard[]>();

  addCard(userId: string, card: Omit<TimelineCard, "id" | "timestamp">): TimelineCard {
    const timelineCard: TimelineCard = {
      ...card,
      id: uuid(),
      timestamp: new Date().toISOString()
    };

    const existing = this.cardsByUser.get(userId) ?? [];
    const next = [timelineCard, ...existing].slice(0, 200);
    this.cardsByUser.set(userId, next);
    return timelineCard;
  }

  list(userId: string): TimelineCard[] {
    return this.cardsByUser.get(userId) ?? [];
  }
}
