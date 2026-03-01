import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { v4 as uuid } from "uuid";

import type { ActionProposal, RiskLevel } from "@mark/contracts";

interface BuildProposalInput {
  connectorId: string;
  action: string;
  payload: Record<string, unknown>;
  riskLevel?: RiskLevel;
}

@Injectable()
export class ComposioActionMapperService {
  buildProposal(input: BuildProposalInput): ActionProposal {
    const riskLevel = input.riskLevel ?? this.deriveRisk(input.action);
    return {
      id: uuid(),
      connectorId: input.connectorId,
      action: input.action,
      payload: {
        ...input.payload,
        idempotencyKey: this.buildIdempotencyKey(input)
      },
      riskLevel,
      requiresConfirmation: this.isWriteAction(input.action),
      requiresDoubleConfirmation: this.isSensitiveAction(input.action),
      createdAt: new Date().toISOString()
    };
  }

  isWriteAction(action: string): boolean {
    return ["send", "reply", "delete", "transfer", "share", "archive", "create"].some((verb) =>
      action.toLowerCase().includes(verb)
    );
  }

  isSensitiveAction(action: string): boolean {
    return ["delete", "transfer", "permission", "share_external"].some((verb) =>
      action.toLowerCase().includes(verb)
    );
  }

  private deriveRisk(action: string): RiskLevel {
    if (this.isSensitiveAction(action)) {
      return "critical";
    }
    if (this.isWriteAction(action)) {
      return "high";
    }
    return "low";
  }

  private buildIdempotencyKey(input: BuildProposalInput): string {
    const serialized = JSON.stringify({
      connectorId: input.connectorId,
      action: input.action,
      payload: input.payload
    });
    return createHash("sha256").update(serialized).digest("hex").slice(0, 24);
  }
}
