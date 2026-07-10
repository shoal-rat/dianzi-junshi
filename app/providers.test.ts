import { describe, expect, test } from "bun:test";
import { claudeEventText, codexEventText } from "./providers";

describe("local CLI event parsing", () => {
  test("reads the final Codex agent message", () => {
    expect(codexEventText({
      type: "item.completed",
      item: { type: "agent_message", text: "可以这样回" },
    })).toEqual({ text: "可以这样回", partial: false });
  });

  test("reads Claude Code partial text", () => {
    expect(claudeEventText({
      type: "stream_event",
      event: { delta: { type: "text_delta", text: "先别急" } },
    })).toEqual({ text: "先别急", partial: true });
  });
});
