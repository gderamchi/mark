import { Injectable } from "@nestjs/common";

import type { ActionProposal, GuardrailDecision } from "@mark/contracts";

import { ConnectorsService } from "@/modules/connectors/connectors.service";

@Injectable()
export class PolicyService {
  constructor(private readonly connectorsService: ConnectorsService) {}

  evaluateAction(userId: string, proposal: ActionProposal): GuardrailDecision {
    const action = proposal.action.toLowerCase();
    const writeAction = this.connectorsService.isWriteAction(action);

    if (!this.connectorsService.isConnected(userId, proposal.connectorId)) {
      return {
        decision: "deny",
        reason: "Connector is not connected"
      };
    }

    if (writeAction && !this.connectorsService.isActionCertified(proposal.connectorId, action)) {
      return {
        decision: "deny",
        reason: "Connector is read-only for this action until certification is complete"
      };
    }

    if (this.isSensitive(action) || proposal.riskLevel === "critical") {
      return {
        decision: "double_confirm",
        reason: "Sensitive action requires double confirmation"
      };
    }

    if (writeAction) {
      return {
        decision: "confirm",
        reason: "Write action requires explicit confirmation"
      };
    }

    return {
      decision: "allow",
      reason: "Read-only action allowed"
    };
  }

  private isSensitive(action: string): boolean {
    return ["delete", "transfer", "share_external", "permission", "billing"].some((keyword) =>
      action.includes(keyword)
    );
  }
}
