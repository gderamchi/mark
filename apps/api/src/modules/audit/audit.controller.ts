import { Controller, Get, Query } from "@nestjs/common";

import { CurrentUserId } from "@/common/current-user-id.decorator";

import { AuditService } from "./audit.service";

@Controller("v1/audit")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get("events")
  events(@CurrentUserId() userId: string, @Query("limit") limit?: string) {
    const parsed = Number(limit ?? 100);
    const safeLimit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 100;
    return {
      events: this.auditService.listByUser(userId, safeLimit)
    };
  }
}
