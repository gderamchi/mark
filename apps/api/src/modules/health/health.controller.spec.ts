import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("returns status ok with current timestamp", () => {
    const controller = new HealthController(
      {
        isConfigured: () => false,
        getLastProviderErrorAt: () => null,
        getMode: () => "fallback"
      } as any,
      {
        isConfigured: () => false
      } as any
    );
    const result = controller.getHealth();

    expect(result.status).toBe("ok");
    expect(result.now).toBeDefined();
    // Verify it's a valid ISO date
    expect(new Date(result.now).toISOString()).toBe(result.now);
  });

  it("returns voice readiness diagnostics", () => {
    const controller = new HealthController(
      {
        isConfigured: () => true,
        getLastProviderErrorAt: () => "2026-03-01T00:00:00.000Z",
        getMode: () => "live"
      } as any,
      {
        isConfigured: () => false
      } as any
    );

    expect(controller.getVoiceHealth()).toEqual({
      sttConfigured: true,
      ttsConfigured: false,
      lastSttErrorAt: "2026-03-01T00:00:00.000Z",
      mode: "live"
    });
  });
});
