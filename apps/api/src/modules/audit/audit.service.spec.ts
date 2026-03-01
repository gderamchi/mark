import { AuditService } from "./audit.service";

describe("AuditService", () => {
  let service: AuditService;

  beforeEach(() => {
    service = new AuditService();
  });

  it("adds an event and returns it with id and createdAt", () => {
    const event = service.addEvent({
      userId: "u1",
      type: "session.started",
      actor: "system",
      status: "success",
      detail: "Voice session started"
    });

    expect(event.id).toBeDefined();
    expect(event.createdAt).toBeDefined();
    expect(event.userId).toBe("u1");
    expect(event.type).toBe("session.started");
    expect(event.actor).toBe("system");
    expect(event.status).toBe("success");
    expect(event.detail).toBe("Voice session started");
  });

  it("stores events in reverse chronological order", () => {
    service.addEvent({ userId: "u1", type: "first", actor: "user", status: "success", detail: "a" });
    service.addEvent({ userId: "u1", type: "second", actor: "user", status: "success", detail: "b" });

    const events = service.listByUser("u1");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("second");
    expect(events[1].type).toBe("first");
  });

  it("filters events by userId", () => {
    service.addEvent({ userId: "u1", type: "a", actor: "user", status: "success", detail: "x" });
    service.addEvent({ userId: "u2", type: "b", actor: "user", status: "success", detail: "y" });
    service.addEvent({ userId: "u1", type: "c", actor: "user", status: "success", detail: "z" });

    const eventsU1 = service.listByUser("u1");
    expect(eventsU1).toHaveLength(2);
    expect(eventsU1.every((e) => e.userId === "u1")).toBe(true);

    const eventsU2 = service.listByUser("u2");
    expect(eventsU2).toHaveLength(1);
    expect(eventsU2[0].type).toBe("b");
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      service.addEvent({ userId: "u1", type: `event-${i}`, actor: "user", status: "success", detail: `${i}` });
    }

    const events = service.listByUser("u1", 3);
    expect(events).toHaveLength(3);
  });

  it("returns empty array for unknown user", () => {
    expect(service.listByUser("nobody")).toEqual([]);
  });

  it("caps stored events at 2000", () => {
    for (let i = 0; i < 2005; i++) {
      service.addEvent({ userId: "u1", type: "flood", actor: "system", status: "success", detail: `${i}` });
    }

    // The internal events array is capped, but we can only observe through listByUser
    // which filters by user — all 2005 were for u1 so at most 2000 survive
    const events = service.listByUser("u1", 2500);
    expect(events.length).toBeLessThanOrEqual(2000);
  });

  it("preserves optional connectorId and action fields", () => {
    const event = service.addEvent({
      userId: "u1",
      type: "connector.action.executed",
      actor: "agent",
      connectorId: "gmail",
      action: "email.reply",
      status: "success",
      detail: "Executed email.reply"
    });

    expect(event.connectorId).toBe("gmail");
    expect(event.action).toBe("email.reply");
  });
});
