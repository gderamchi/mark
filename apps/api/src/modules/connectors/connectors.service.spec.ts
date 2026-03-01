import { NotFoundException } from "@nestjs/common";

import { AuditService } from "@/modules/audit/audit.service";

import { ConnectorsService } from "./connectors.service";

describe("ConnectorsService", () => {
  let service: ConnectorsService;
  let auditService: AuditService;

  beforeEach(() => {
    auditService = new AuditService();
    service = new ConnectorsService(auditService);
  });

  describe("listConnectors", () => {
    it("returns all 5 connectors with connected=false by default", () => {
      const connectors = service.listConnectors("u1");

      expect(connectors).toHaveLength(5);
      expect(connectors.every((c) => c.connected === false)).toBe(true);
      expect(connectors.map((c) => c.id)).toEqual(["gmail", "slack", "discord", "github", "notion"]);
    });

    it("shows connected=true for connected connectors", () => {
      service.connect("u1", "gmail");

      const connectors = service.listConnectors("u1");
      const gmail = connectors.find((c) => c.id === "gmail");
      const slack = connectors.find((c) => c.id === "slack");

      expect(gmail?.connected).toBe(true);
      expect(slack?.connected).toBe(false);
    });

    it("sets writeMode based on certifiedActions", () => {
      const connectors = service.listConnectors("u1");
      const gmail = connectors.find((c) => c.id === "gmail");
      const slack = connectors.find((c) => c.id === "slack");

      expect(gmail?.writeMode).toBe("action-certified");
      expect(slack?.writeMode).toBe("read-only");
    });
  });

  describe("connect / disconnect", () => {
    it("connects a connector and records audit event", () => {
      const result = service.connect("u1", "gmail");

      expect(result.connectorId).toBe("gmail");
      expect(result.connected).toBe(true);
      expect(result.oauthUrl).toBeDefined();

      expect(service.isConnected("u1", "gmail")).toBe(true);

      const events = auditService.listByUser("u1");
      expect(events.some((e) => e.type === "connector.connect")).toBe(true);
    });

    it("disconnects a connector", () => {
      service.connect("u1", "gmail");
      const result = service.disconnect("u1", "gmail");

      expect(result.connected).toBe(false);
      expect(service.isConnected("u1", "gmail")).toBe(false);
    });

    it("throws NotFoundException for unknown connector", () => {
      expect(() => service.connect("u1", "nonexistent")).toThrow(NotFoundException);
    });
  });

  describe("isConnected", () => {
    it("returns false for unconnected connector", () => {
      expect(service.isConnected("u1", "gmail")).toBe(false);
    });

    it("returns true after connecting", () => {
      service.connect("u1", "gmail");
      expect(service.isConnected("u1", "gmail")).toBe(true);
    });
  });

  describe("isActionCertified", () => {
    it("returns true for read actions regardless of certification", () => {
      expect(service.isActionCertified("slack", "channel.list")).toBe(true);
    });

    it("returns true for certified write actions on gmail", () => {
      expect(service.isActionCertified("gmail", "email.reply")).toBe(true);
      expect(service.isActionCertified("gmail", "email.send")).toBe(true);
    });

    it("returns false for uncertified write actions", () => {
      expect(service.isActionCertified("slack", "message.send")).toBe(false);
    });
  });

  describe("isWriteAction", () => {
    it("identifies write actions", () => {
      expect(service.isWriteAction("email.send")).toBe(true);
      expect(service.isWriteAction("email.reply")).toBe(true);
      expect(service.isWriteAction("email.delete")).toBe(true);
      expect(service.isWriteAction("file.share")).toBe(true);
      expect(service.isWriteAction("repo.create")).toBe(true);
    });

    it("identifies read actions", () => {
      expect(service.isWriteAction("email.read")).toBe(false);
      expect(service.isWriteAction("channel.list")).toBe(false);
      expect(service.isWriteAction("inbox.fetch")).toBe(false);
    });
  });

  describe("fetchRecentEmails", () => {
    it("returns empty array when gmail is not connected", () => {
      expect(service.fetchRecentEmails("u1", 24)).toEqual([]);
    });

    it("returns emails when gmail is connected", () => {
      service.connect("u1", "gmail");
      const emails = service.fetchRecentEmails("u1", 24);

      expect(emails.length).toBeGreaterThan(0);
      expect(emails[0].connectorId).toBe("gmail");
      expect(emails[0].from).toBeDefined();
      expect(emails[0].subject).toBeDefined();
    });
  });

  describe("executeAction", () => {
    it("executes action for connected connector", () => {
      service.connect("u1", "gmail");
      const result = service.executeAction("u1", {
        id: "p-1",
        connectorId: "gmail",
        action: "email.reply",
        payload: {},
        riskLevel: "high",
        requiresConfirmation: true,
        createdAt: new Date().toISOString()
      });

      expect(result.status).toBe("ok");
      expect(result.connector).toBe("gmail");
    });

    it("throws when connector is not connected", () => {
      expect(() =>
        service.executeAction("u1", {
          id: "p-1",
          connectorId: "gmail",
          action: "email.reply",
          payload: {},
          riskLevel: "high",
          requiresConfirmation: true,
          createdAt: new Date().toISOString()
        })
      ).toThrow(NotFoundException);
    });

    it("deduplicates by idempotency key", () => {
      service.connect("u1", "gmail");
      const proposal = {
        id: "p-1",
        connectorId: "gmail",
        action: "email.reply",
        payload: { idempotencyKey: "dedup-123" },
        riskLevel: "high" as const,
        requiresConfirmation: true,
        createdAt: new Date().toISOString()
      };

      const first = service.executeAction("u1", proposal);
      expect(first.status).toBe("ok");

      const second = service.executeAction("u1", proposal);
      expect(second.status).toBe("duplicate_ignored");
    });

    it("records audit event on execution", () => {
      service.connect("u1", "gmail");
      service.executeAction("u1", {
        id: "p-1",
        connectorId: "gmail",
        action: "email.reply",
        payload: {},
        riskLevel: "high",
        requiresConfirmation: true,
        createdAt: new Date().toISOString()
      });

      const events = auditService.listByUser("u1");
      expect(events.some((e) => e.type === "connector.action.executed")).toBe(true);
    });
  });
});
