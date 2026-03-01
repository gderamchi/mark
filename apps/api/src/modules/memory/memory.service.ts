import { Injectable } from "@nestjs/common";

import { AuditService } from "@/modules/audit/audit.service";

import { BackboardAdapter } from "./backboard.adapter";

@Injectable()
export class MemoryService {
  constructor(
    private readonly backboardAdapter: BackboardAdapter,
    private readonly auditService: AuditService
  ) {}

  async setOptOut(userId: string, enabled: boolean) {
    const record = await this.backboardAdapter.setOptOut(userId, enabled);
    this.auditService.addEvent({
      userId,
      type: "memory.opt_out",
      actor: "user",
      status: "success",
      detail: enabled ? "Memory persistence disabled" : "Memory persistence enabled"
    });

    return {
      optedOut: record.optedOut
    };
  }

  async purge(userId: string) {
    await this.backboardAdapter.purge(userId);
    this.auditService.addEvent({
      userId,
      type: "memory.purge",
      actor: "user",
      status: "success",
      detail: "Memory purged"
    });

    return {
      purged: true
    };
  }

  async getContext(userId: string): Promise<{ optedOut: boolean; profileNotes: string[] }> {
    const record = await this.backboardAdapter.getRecord(userId);
    return {
      optedOut: record.optedOut,
      profileNotes: record.profileNotes
    };
  }

  async maybeRemember(userId: string, note: string): Promise<void> {
    await this.backboardAdapter.addProfileNote(userId, note);
  }
}
