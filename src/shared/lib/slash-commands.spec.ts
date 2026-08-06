import { describe, expect, it, vi } from "vitest";
import { buildSlashHelpText, getSlashCompletions, matchSlashCommand, type SlashCommandContext } from "./slash-commands";

function commandContext(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    chatId: "chat-1",
    mode: "roleplay",
    generate: vi.fn(),
    illustrate: vi.fn(),
    createMessage: vi.fn(),
    invalidate: vi.fn(),
    characterNames: ["Mira"],
    latestAssistantMessage: { id: "assistant-1", content: "Mira catches the candle." },
    ...overrides,
  };
}

describe("/illustrate", () => {
  it("forwards arbitrary trimmed guidance without creating a message", async () => {
    const matched = matchSlashCommand("/illustrate   focus on Mira from above, in watercolor   ");
    const ctx = commandContext();

    expect(matched?.command.name).toBe("illustrate");
    await matched!.command.execute(matched!.args, ctx);

    expect(ctx.illustrate).toHaveBeenCalledWith({
      forMessageId: "assistant-1",
      guidance: "focus on Mira from above, in watercolor",
    });
    expect(ctx.createMessage).not.toHaveBeenCalled();
    expect(ctx.generate).not.toHaveBeenCalled();
  });

  it("preserves guidance-free manual illustration", async () => {
    const matched = matchSlashCommand("/illustrate");
    const ctx = commandContext();

    await matched!.command.execute(matched!.args, ctx);

    expect(ctx.illustrate).toHaveBeenCalledWith({ forMessageId: "assistant-1" });
  });

  it("returns ephemeral feedback when there is no assistant response", async () => {
    const matched = matchSlashCommand("/illustrate show the room");
    const ctx = commandContext({ latestAssistantMessage: null });

    const result = await matched!.command.execute(matched!.args, ctx);

    expect(result.feedback).toBe("There is no assistant scene to illustrate yet.");
    expect(ctx.illustrate).not.toHaveBeenCalled();
  });

  it("appears in autocomplete and help", () => {
    expect(getSlashCompletions("/ill").map((command) => command.name)).toContain("illustrate");
    expect(buildSlashHelpText()).toContain("/illustrate [guidance]");
  });
});
