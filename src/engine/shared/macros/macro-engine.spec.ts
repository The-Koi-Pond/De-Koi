import { afterEach, describe, expect, it, vi } from "vitest";
import { humanizeIdleDuration, resolveMacros, type MacroContext } from "./macro-engine";

const ctx: MacroContext = {
  user: "Chai",
  char: "Mira",
  characters: ["Mira", "Tom"],
  variables: {},
  chatId: "chat-1",
  lastMessage: "Tom: Over here!",
  lastUserMessage: "Where is everyone?",
  lastCharMessage: "Tom: Over here!",
  characterFields: { example: "<START>\nMira: Hi." },
  personaFields: { description: "A tired courier.", appearance: "Red scarf." },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SillyTavern macros", () => {
  it("fills chat history, group, and persona field macros", () => {
    expect(
      resolveMacros(
        "{{lastUserMessage}} | {{lastCharMessage}} | {{lastMessage}} | {{group}} | {{notChar}} | {{personaDescription}} {{personaAppearance}}",
        ctx,
      ),
    ).toBe(
      "Where is everyone? | Tom: Over here! | Tom: Over here! | Mira, Tom | Tom, Chai | A tired courier. Red scarf.",
    );
    expect(resolveMacros("{{mesExamples}}", ctx)).toBe("<START>\nMira: Hi.");
  });

  it("picks the same option every time for the same chat and position", () => {
    const template = "{{pick::rain::snow::fog::sun}} then {{pick::rain::snow::fog::sun}}";
    const first = resolveMacros(template, ctx);

    expect(resolveMacros(template, ctx)).toBe(first);
    expect(first).toMatch(/^(rain|snow|fog|sun) then (rain|snow|fog|sun)$/);
    const otherChats = new Set(
      Array.from({ length: 12 }, (_, index) =>
        resolveMacros("{{pick:rain,snow,fog,sun}}", { ...ctx, chatId: `chat-${index}` }),
      ),
    );
    expect(otherChats.size).toBeGreaterThan(1);
  });

  it("reads the older comma list form of {{random}}", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);

    expect(resolveMacros("{{random:red,green,blue}}", ctx)).toBe("blue");
    expect(resolveMacros("{{random::red::green}}", ctx)).toBe("green");
  });

  it("rolls SillyTavern dice formulas", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);

    expect(resolveMacros("{{roll:d20}}", ctx)).toBe("20");
    expect(resolveMacros("{{roll:1d20+5}}", ctx)).toBe("25");
    expect(resolveMacros("{{roll:2d6-1}}", ctx)).toBe("11");
    expect(resolveMacros("{{roll 6}}", ctx)).toBe("6");
    expect(resolveMacros("{{roll:3d6}}", ctx)).toBe("18");
  });

  it("describes idle time the way SillyTavern does", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");

    expect(humanizeIdleDuration(null, now)).toBe("just now");
    expect(humanizeIdleDuration("2026-06-01T11:59:50.000Z", now)).toBe("a few seconds");
    expect(humanizeIdleDuration("2026-06-01T11:55:00.000Z", now)).toBe("5 minutes");
    expect(humanizeIdleDuration("2026-06-01T09:00:00.000Z", now)).toBe("3 hours");
    expect(humanizeIdleDuration("2026-05-29T12:00:00.000Z", now)).toBe("3 days");
  });

  it("formats {{isodate}} as a calendar date", () => {
    expect(resolveMacros("{{isodate}}", { ...ctx, timeZone: "UTC" })).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
