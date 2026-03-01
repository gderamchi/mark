import { AuditService } from "@/modules/audit/audit.service";

import { BackboardAdapter } from "./backboard.adapter";
import { MemoryService } from "./memory.service";

function createBackboardAdapter(): BackboardAdapter {
  const configService = {
    get: jest.fn().mockReturnValue(undefined)
  } as any;
  return new BackboardAdapter(configService);
}

describe("MemoryService", () => {
  let service: MemoryService;
  let auditService: AuditService;

  beforeEach(() => {
    auditService = new AuditService();
    const backboard = createBackboardAdapter();
    service = new MemoryService(backboard, auditService);
  });

  describe("getContext", () => {
    it("returns default context for new user", async () => {
      const context = await service.getContext("u1");

      expect(context.optedOut).toBe(false);
      expect(context.profileNotes).toEqual([]);
    });

    it("returns profile notes after remembering", async () => {
      await service.maybeRemember("u1", "User likes dark mode");
      await service.maybeRemember("u1", "User prefers concise replies");

      const context = await service.getContext("u1");
      expect(context.profileNotes).toHaveLength(2);
      expect(context.profileNotes).toContain("User likes dark mode");
      expect(context.profileNotes).toContain("User prefers concise replies");
    });
  });

  describe("setOptOut", () => {
    it("enables opt-out and records audit event", async () => {
      const result = await service.setOptOut("u1", true);

      expect(result.optedOut).toBe(true);

      const events = auditService.listByUser("u1");
      expect(events.some((e) => e.type === "memory.opt_out")).toBe(true);
    });

    it("disables opt-out", async () => {
      await service.setOptOut("u1", true);
      const result = await service.setOptOut("u1", false);

      expect(result.optedOut).toBe(false);
    });
  });

  describe("maybeRemember", () => {
    it("does not store notes when opted out", async () => {
      await service.setOptOut("u1", true);
      await service.maybeRemember("u1", "This should not be stored");

      const context = await service.getContext("u1");
      expect(context.profileNotes).toEqual([]);
    });

    it("stores notes when not opted out", async () => {
      await service.maybeRemember("u1", "Note 1");
      const context = await service.getContext("u1");
      expect(context.profileNotes).toContain("Note 1");
    });
  });

  describe("purge", () => {
    it("removes all profile data and records audit event", async () => {
      await service.maybeRemember("u1", "Some note");
      const result = await service.purge("u1");

      expect(result.purged).toBe(true);

      const context = await service.getContext("u1");
      expect(context.profileNotes).toEqual([]);
      expect(context.optedOut).toBe(false);

      const events = auditService.listByUser("u1");
      expect(events.some((e) => e.type === "memory.purge")).toBe(true);
    });
  });
});
