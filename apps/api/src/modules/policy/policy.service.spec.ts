import type { ActionProposal } from "@mark/contracts";

import { PolicyService } from "./policy.service";

function buildProposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "p-1",
    connectorId: "gmail",
    action: "email.reply",
    payload: {},
    riskLevel: "high",
    requiresConfirmation: true,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

describe("PolicyService", () => {
  it("returns deny when connector is not connected for write actions", () => {
    const connectorsService = {
      isWriteAction: jest.fn().mockReturnValue(true),
      isActionCertified: jest.fn().mockReturnValue(true),
      isConnected: jest.fn().mockReturnValue(false)
    } as any;

    const service = new PolicyService(connectorsService);

    const decision = service.evaluateAction("u1", buildProposal({ action: "email.reply" }));

    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("not connected");
    expect(connectorsService.isActionCertified).not.toHaveBeenCalled();
  });

  it("returns deny when connector is not connected for read actions", () => {
    const connectorsService = {
      isWriteAction: jest.fn().mockReturnValue(false),
      isActionCertified: jest.fn(),
      isConnected: jest.fn().mockReturnValue(false)
    } as any;

    const service = new PolicyService(connectorsService);

    const decision = service.evaluateAction("u1", buildProposal({ action: "email.read" }));

    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("not connected");
  });

  it("returns deny when write action is not certified", () => {
    const connectorsService = {
      isWriteAction: jest.fn().mockReturnValue(true),
      isActionCertified: jest.fn().mockReturnValue(false),
      isConnected: jest.fn().mockReturnValue(true)
    } as any;

    const service = new PolicyService(connectorsService);

    const decision = service.evaluateAction("u1", buildProposal());

    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("read-only");
  });

  it("requires double confirmation for sensitive actions", () => {
    const connectorsService = {
      isWriteAction: jest.fn().mockReturnValue(true),
      isActionCertified: jest.fn().mockReturnValue(true),
      isConnected: jest.fn().mockReturnValue(true)
    } as any;

    const service = new PolicyService(connectorsService);

    const decision = service.evaluateAction(
      "u1",
      buildProposal({ action: "email.delete", riskLevel: "critical" })
    );

    expect(decision.decision).toBe("double_confirm");
  });

  it("requires confirmation for normal write actions", () => {
    const connectorsService = {
      isWriteAction: jest.fn().mockReturnValue(true),
      isActionCertified: jest.fn().mockReturnValue(true),
      isConnected: jest.fn().mockReturnValue(true)
    } as any;

    const service = new PolicyService(connectorsService);

    const decision = service.evaluateAction("u1", buildProposal({ action: "email.reply" }));

    expect(decision.decision).toBe("confirm");
  });
});
