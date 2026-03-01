import { TimelineService } from "./timeline.service";

describe("TimelineService", () => {
  let service: TimelineService;

  beforeEach(() => {
    service = new TimelineService();
  });

  it("adds a card and returns it with id and timestamp", () => {
    const card = service.addCard("u1", {
      type: "fetch",
      title: "Fetched inbox",
      body: "Pulled 3 emails from the last 24h.",
      source: "gmail",
      status: "success"
    });

    expect(card.id).toBeDefined();
    expect(card.timestamp).toBeDefined();
    expect(card.type).toBe("fetch");
    expect(card.title).toBe("Fetched inbox");
    expect(card.source).toBe("gmail");
    expect(card.status).toBe("success");
  });

  it("stores cards in reverse chronological order", () => {
    service.addCard("u1", { type: "fetch", title: "First", body: "a", source: "gmail", status: "success" });
    service.addCard("u1", { type: "analysis", title: "Second", body: "b", source: "agent", status: "success" });

    const cards = service.list("u1");
    expect(cards).toHaveLength(2);
    expect(cards[0].title).toBe("Second");
    expect(cards[1].title).toBe("First");
  });

  it("isolates cards by user", () => {
    service.addCard("u1", { type: "fetch", title: "U1 card", body: "a", source: "gmail", status: "success" });
    service.addCard("u2", { type: "error", title: "U2 card", body: "b", source: "session", status: "error" });

    expect(service.list("u1")).toHaveLength(1);
    expect(service.list("u1")[0].title).toBe("U1 card");

    expect(service.list("u2")).toHaveLength(1);
    expect(service.list("u2")[0].title).toBe("U2 card");
  });

  it("returns empty array for unknown user", () => {
    expect(service.list("nobody")).toEqual([]);
  });

  it("caps cards at 200 per user", () => {
    for (let i = 0; i < 210; i++) {
      service.addCard("u1", { type: "info", title: `Card ${i}`, body: "", source: "test", status: "success" });
    }

    const cards = service.list("u1");
    expect(cards).toHaveLength(200);
    // Most recent card should be Card 209
    expect(cards[0].title).toBe("Card 209");
  });
});
