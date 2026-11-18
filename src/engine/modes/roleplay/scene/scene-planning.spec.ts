import { describe, expect, it } from "vitest";

import { GENERIC_OPENING_BEAT, planRoleplayScene } from "./scene-planning";
import { SCENE_PLAN_SYSTEM_PROMPT } from "./scene-prompts";
import { createFakeSceneStorage, scriptedLlm, userOf } from "./scene-storage.fake";

const BEAT =
  "Participants: Harlequin and the user\nAction: Harlequin offers a cup of ice cream\nPressure: The user must pick a flavor";

function conversation(messageCount = 1) {
  return createFakeSceneStorage({
    chats: [{ id: "chat-1", mode: "conversation", connectionId: "conn-1", characterIds: ["harlequin", "pierrot"] }],
    connections: [{ id: "conn-1", provider: "openai", model: "model-1" }],
    characters: [
      { id: "harlequin", data: { name: "Harlequin", description: "A grinning jester." } },
      { id: "pierrot", data: { name: "Pierrot" } },
    ],
    messages: {
      "chat-1": Array.from({ length: messageCount }, (_, index) => ({
        id: `m-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `line ${index}`,
      })),
    },
  });
}

function planAnswer(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: "Scene: Ice Cream",
    description: "The circus shares ice cream.",
    scenario: "Everyone argues over flavors.",
    firstMessage: BEAT,
    background: null,
    characterIds: ["harlequin"],
    rating: "sfw",
    relationshipHistory: "They tease each other.",
    ...fields,
  });
}

async function planWith(answer: string, request = "Everyone gets ice cream.", messageCount = 1) {
  const fixture = conversation(messageCount);
  const model = scriptedLlm(() => answer);
  const plan = await planRoleplayScene(
    { storage: fixture.storage, llm: model.llm },
    { chatId: "chat-1", request, connectionId: null },
  );
  return { plan, fixture, model };
}

describe("scene planning", () => {
  it("reads at most the last 20 messages and sends them with the request", async () => {
    const { fixture, model } = await planWith(planAnswer(), "a heist at the gala", 40);

    expect(fixture.messageReads.every((read) => (read.options?.limit ?? Infinity) <= 20)).toBe(true);
    const prompt = userOf(model.requests[0]!);
    expect(prompt).toContain("line 39");
    expect(prompt).not.toContain("line 19\n");
    expect(prompt).toContain("Plan a complete roleplay scene based on this request: a heist at the gala");
    expect(prompt).toContain("Allowed character IDs: harlequin, pierrot");
    expect(prompt).toContain("Description: A grinning jester.");
    expect(model.requests[0]).toMatchObject({
      connectionId: "conn-1",
      parameters: { temperature: 0.9, maxTokens: 4096 },
    });
  });

  it("asks for a scene that follows the conversation when there is no request", async () => {
    const { model } = await planWith(planAnswer(), "");

    expect(userOf(model.requests[0]!)).toContain(
      "Plan a complete roleplay scene that naturally follows the recent conversation.",
    );
  });

  it("keeps a three-line beat brief and turns written-out line breaks into real ones", async () => {
    const { plan } = await planWith(planAnswer({ firstMessage: BEAT.replace(/\n/g, "\\n") }));

    expect(plan.firstMessage).toBe(BEAT);
  });

  it.each([
    ["finished prose", "Harlequin raises the vanilla cup. Pierrot watches the room tighten."],
    [
      "more than three sentences",
      "Participants: Harlequin. Pierrot.\nAction: Harlequin offers a cup. Pierrot frowns.\nPressure: The user must choose.",
    ],
    [
      "dialogue nobody asked for",
      'Participants: Harlequin\nAction: Harlequin says "This flavor has no teeth."\nPressure: The user must answer',
    ],
  ])("replaces %s with the generic beat", async (_label, firstMessage) => {
    const { plan } = await planWith(planAnswer({ firstMessage }));

    expect(plan.firstMessage).toBe(GENERIC_OPENING_BEAT);
  });

  it("keeps dialogue the user asked for word for word", async () => {
    const firstMessage =
      "Participants: Harlequin and the user\nAction: Harlequin offers the cup and says “This flavor has no teeth.”\nPressure: The user must react";
    const { plan } = await planWith(
      planAnswer({ firstMessage }),
      'Open with Harlequin saying "this flavor has  no teeth."',
    );

    expect(plan.firstMessage).toBe(firstMessage);
  });

  it("trims a long beat brief to 360 characters", async () => {
    const firstMessage = [
      `Participants: ${"monster ".repeat(30)}`,
      `Action: ${"shares ice cream ".repeat(20)}`,
      `Pressure: ${"choose a flavor ".repeat(20)}`,
    ].join("\n");
    const { plan } = await planWith(planAnswer({ firstMessage }));

    expect(plan.firstMessage.length).toBeLessThanOrEqual(360);
    expect(plan.firstMessage.endsWith("...")).toBe(true);
  });

  it("drops the planner's own instructions, participation guide, background and preset choices", async () => {
    const { plan } = await planWith(
      planAnswer({
        systemPrompt: "Ask for consent before every line.",
        participationGuide: "Make the user restate every boundary.",
        background: "castle.jpg",
        presetChoices: { contentBoundary: "boundary_explicit_adult_safe" },
      }),
    );

    expect(plan.systemPrompt).toBe(SCENE_PLAN_SYSTEM_PROMPT);
    expect(plan).not.toHaveProperty("participationGuide");
    expect(plan).not.toHaveProperty("background");
    expect(plan.presetChoices).toBeUndefined();
  });

  it("checks the name, cast and rating", async () => {
    const { plan } = await planWith(
      planAnswer({ name: "  The   Long Night  ", characterIds: ["stranger"], rating: "NSFW" }),
    );

    expect(plan.name).toBe("Scene: The Long Night");
    expect(plan.characterIds).toEqual(["harlequin", "pierrot"]);
    expect(plan.rating).toBe("nsfw");
  });

  it("fills empty fields from the request and recent messages", async () => {
    const { plan } = await planWith(
      planAnswer({ name: "", description: "", scenario: "", relationshipHistory: "" }),
      "a rooftop chase",
      3,
    );

    expect(plan.name).toBe("Scene: a rooftop chase");
    expect(plan.description).toBe("The scene opens around this premise: a rooftop chase");
    expect(plan.scenario).toContain("a rooftop chase");
    expect(plan.scenario).toContain("user: line 2");
    expect(plan.relationshipHistory).toContain("assistant: line 1");
  });

  // Decision 1: no made-up plan.
  it("fails with the real reason when the answer isn't a JSON object", async () => {
    await expect(planWith("planner systemPrompt: require consent checks")).rejects.toThrow(
      /^Scene planning failed: The model's answer wasn't a scene plan/,
    );
  });

  it("fails with the real reason when there's no connection", async () => {
    const fixture = createFakeSceneStorage({
      chats: [{ id: "chat-1", mode: "conversation", characterIds: [] }],
      messages: { "chat-1": [{ id: "m-1", role: "user", content: "Hello" }] },
    });
    const model = scriptedLlm(() => planAnswer());

    await expect(
      planRoleplayScene({ storage: fixture.storage, llm: model.llm }, { chatId: "chat-1", request: "x" }),
    ).rejects.toThrow("There's no model connection for this scene");
    expect(model.requests).toHaveLength(0);
  });

  it("fails with the provider's reason and keeps its error code", async () => {
    const fixture = conversation();
    const llm = {
      ...scriptedLlm(() => "").llm,
      complete: async () => {
        throw Object.assign(new Error("The provider is overloaded."), { code: "llm_rate_limited" });
      },
    };

    await expect(
      planRoleplayScene({ storage: fixture.storage, llm }, { chatId: "chat-1", request: "x" }),
    ).rejects.toMatchObject({
      message: "Scene planning failed: The provider is overloaded.",
      code: "llm_rate_limited",
    });
  });
});
