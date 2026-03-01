import { ComposioActionMapperService } from "./composio-action-mapper.service";

describe("ComposioActionMapperService", () => {
  const service = new ComposioActionMapperService();

  it("adds idempotency key to proposal payload", () => {
    const proposal = service.buildProposal({
      connectorId: "gmail",
      action: "email.send",
      payload: {
        to: "x@y.com",
        subject: "Hi"
      }
    });

    expect(typeof proposal.payload.idempotencyKey).toBe("string");
    expect(String(proposal.payload.idempotencyKey)).toHaveLength(24);
  });

  it("flags sensitive actions as requiring double confirmation", () => {
    const proposal = service.buildProposal({
      connectorId: "gmail",
      action: "email.delete",
      payload: { threadId: "t1" }
    });

    expect(proposal.requiresDoubleConfirmation).toBe(true);
    expect(proposal.riskLevel).toBe("critical");
  });
});
