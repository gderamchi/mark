import { BackboardAdapter } from "./backboard.adapter";

function createAdapter(): BackboardAdapter {
  const configService = {
    get: jest.fn().mockReturnValue(undefined)
  } as any;
  return new BackboardAdapter(configService);
}

describe("BackboardAdapter (in-memory fallback)", () => {
  let adapter: BackboardAdapter;

  beforeEach(() => {
    adapter = createAdapter();
  });

  describe("getRecord", () => {
    it("returns default record for unknown user", async () => {
      const record = await adapter.getRecord("u1");
      expect(record.optedOut).toBe(false);
      expect(record.profileNotes).toEqual([]);
    });
  });

  describe("setOptOut", () => {
    it("enables opt-out", async () => {
      const record = await adapter.setOptOut("u1", true);
      expect(record.optedOut).toBe(true);
    });

    it("disables opt-out", async () => {
      await adapter.setOptOut("u1", true);
      const record = await adapter.setOptOut("u1", false);
      expect(record.optedOut).toBe(false);
    });

    it("persists across calls", async () => {
      await adapter.setOptOut("u1", true);
      const record = await adapter.getRecord("u1");
      expect(record.optedOut).toBe(true);
    });
  });

  describe("addProfileNote", () => {
    it("adds a note", async () => {
      const record = await adapter.addProfileNote("u1", "User prefers dark mode");
      expect(record.profileNotes).toContain("User prefers dark mode");
    });

    it("does not add note when opted out", async () => {
      await adapter.setOptOut("u1", true);
      const record = await adapter.addProfileNote("u1", "Should not be stored");
      expect(record.profileNotes).toEqual([]);
    });

    it("caps notes at 100", async () => {
      for (let i = 0; i < 110; i++) {
        await adapter.addProfileNote("u1", `Note ${i}`);
      }
      const record = await adapter.getRecord("u1");
      expect(record.profileNotes).toHaveLength(100);
      // Should keep the most recent notes
      expect(record.profileNotes[99]).toBe("Note 109");
    });
  });

  describe("purge", () => {
    it("removes all data for a user", async () => {
      await adapter.addProfileNote("u1", "Some note");
      await adapter.setOptOut("u1", true);

      await adapter.purge("u1");

      const record = await adapter.getRecord("u1");
      expect(record.optedOut).toBe(false);
      expect(record.profileNotes).toEqual([]);
    });
  });
});
