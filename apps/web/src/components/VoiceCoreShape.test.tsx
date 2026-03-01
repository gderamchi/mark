import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VoiceCoreShape } from "./VoiceCoreShape";

describe("VoiceCoreShape", () => {
  it("renders stage mode as class and data attribute", () => {
    render(<VoiceCoreShape stageMode="thinking" audioLevel={0.1} isRunning />);

    const shape = screen.getByRole("img", { name: "Voice state: thinking" });
    expect(shape).toHaveAttribute("data-stage-mode", "thinking");
    expect(shape).toHaveClass("voice-core-thinking");
  });

  it("updates listening intensity based on audio level", () => {
    const { rerender } = render(<VoiceCoreShape stageMode="listening" audioLevel={0.05} isRunning />);
    const shape = screen.getByRole("img", { name: "Voice state: listening" });

    expect(shape).toHaveStyle("--voice-level: 0.200");

    rerender(<VoiceCoreShape stageMode="listening" audioLevel={0.2} isRunning />);
    expect(shape).toHaveStyle("--voice-level: 0.800");
  });
});
