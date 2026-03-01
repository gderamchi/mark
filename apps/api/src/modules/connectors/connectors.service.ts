import { Injectable, NotFoundException } from "@nestjs/common";

import type { ActionProposal, ConnectorDescriptor, ConnectorView, MessageDigest } from "@mark/contracts";

import { AuditService } from "@/modules/audit/audit.service";

const CONNECTORS: ConnectorDescriptor[] = [
  {
    id: "gmail",
    name: "Gmail",
    category: "email",
    supportsRead: true,
    supportsWrite: true,
    certifiedActions: ["email.read", "email.reply", "email.send"]
  },
  {
    id: "slack",
    name: "Slack",
    category: "chat",
    supportsRead: true,
    supportsWrite: true,
    certifiedActions: []
  },
  {
    id: "discord",
    name: "Discord",
    category: "chat",
    supportsRead: true,
    supportsWrite: true,
    certifiedActions: []
  },
  {
    id: "github",
    name: "GitHub",
    category: "dev",
    supportsRead: true,
    supportsWrite: true,
    certifiedActions: []
  },
  {
    id: "notion",
    name: "Notion",
    category: "knowledge",
    supportsRead: true,
    supportsWrite: true,
    certifiedActions: []
  }
];

@Injectable()
export class ConnectorsService {
  private readonly connectedByUser = new Map<string, Set<string>>();
  private readonly idempotencySeen = new Set<string>();

  constructor(private readonly auditService: AuditService) {}

  listConnectors(userId: string): ConnectorView[] {
    const connected = this.connectedByUser.get(userId) ?? new Set<string>();

    return CONNECTORS.map((connector) => ({
      ...connector,
      connected: connected.has(connector.id),
      writeMode: connector.certifiedActions.length > 0 ? "action-certified" : "read-only"
    }));
  }

  connect(userId: string, connectorId: string) {
    const connector = this.mustGet(connectorId);
    const set = this.connectedByUser.get(userId) ?? new Set<string>();
    set.add(connector.id);
    this.connectedByUser.set(userId, set);

    this.auditService.addEvent({
      userId,
      type: "connector.connect",
      actor: "user",
      connectorId: connector.id,
      status: "success",
      detail: `${connector.name} connected`
    });

    return {
      connectorId,
      connected: true,
      oauthUrl: `https://auth.example.local/${connectorId}/oauth`
    };
  }

  disconnect(userId: string, connectorId: string) {
    const connector = this.mustGet(connectorId);
    const set = this.connectedByUser.get(userId) ?? new Set<string>();
    set.delete(connector.id);
    this.connectedByUser.set(userId, set);

    this.auditService.addEvent({
      userId,
      type: "connector.disconnect",
      actor: "user",
      connectorId: connector.id,
      status: "success",
      detail: `${connector.name} disconnected`
    });

    return {
      connectorId,
      connected: false
    };
  }

  isConnected(userId: string, connectorId: string): boolean {
    return (this.connectedByUser.get(userId) ?? new Set<string>()).has(connectorId);
  }

  isActionCertified(connectorId: string, action: string): boolean {
    const connector = this.mustGet(connectorId);
    if (!this.isWriteAction(action)) {
      return true;
    }

    const normalizedAction = action.toLowerCase();
    return connector.certifiedActions.some((certifiedAction) => {
      const tail = certifiedAction.split(".").at(-1) ?? certifiedAction;
      return normalizedAction.includes(tail);
    });
  }

  fetchRecentEmails(userId: string, hours: number): MessageDigest[] {
    if (!this.isConnected(userId, "gmail")) {
      return [];
    }

    const now = Date.now();
    return [
      {
        id: "mail-1",
        connectorId: "gmail",
        from: "ceo@important-client.com",
        fromDomain: "important-client.com",
        subject: "Contract signature needed before 6pm",
        snippet: "Please review final version and confirm legal terms.",
        receivedAt: new Date(now - 60 * 60 * 1000).toISOString()
      },
      {
        id: "mail-2",
        connectorId: "gmail",
        from: "newsletter@producthunt.com",
        fromDomain: "producthunt.com",
        subject: "Daily top launches",
        snippet: "Unsubscribe at any time and discover new products.",
        receivedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString()
      },
      {
        id: "mail-3",
        connectorId: "gmail",
        from: "ops@partner.io",
        fromDomain: "partner.io",
        subject: "Urgent: migration window update",
        snippet: "Need your approval for schedule shift by tomorrow morning.",
        receivedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString()
      }
    ].filter((mail) => Date.now() - new Date(mail.receivedAt).getTime() <= hours * 60 * 60 * 1000);
  }

  executeAction(userId: string, proposal: ActionProposal): Record<string, unknown> {
    const connector = this.mustGet(proposal.connectorId);
    if (!this.isConnected(userId, connector.id)) {
      throw new NotFoundException(`Connector ${connector.id} is not connected`);
    }

    const idempotencyKey = String(proposal.payload.idempotencyKey ?? "");
    if (idempotencyKey && this.idempotencySeen.has(idempotencyKey)) {
      return {
        status: "duplicate_ignored",
        idempotencyKey
      };
    }

    if (idempotencyKey) {
      this.idempotencySeen.add(idempotencyKey);
    }

    this.auditService.addEvent({
      userId,
      type: "connector.action.executed",
      actor: "agent",
      connectorId: proposal.connectorId,
      action: proposal.action,
      status: "success",
      detail: `Executed action ${proposal.action}`
    });

    return {
      status: "ok",
      connector: connector.id,
      action: proposal.action,
      executedAt: new Date().toISOString()
    };
  }

  isWriteAction(action: string): boolean {
    return ["send", "reply", "delete", "transfer", "share", "archive", "create"].some((verb) =>
      action.toLowerCase().includes(verb)
    );
  }

  private mustGet(connectorId: string): ConnectorDescriptor {
    const connector = CONNECTORS.find((candidate) => candidate.id === connectorId);
    if (!connector) {
      throw new NotFoundException(`Unknown connector: ${connectorId}`);
    }
    return connector;
  }
}
