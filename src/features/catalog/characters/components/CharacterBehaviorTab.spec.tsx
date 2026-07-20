import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterBehavioralInterpretation, CharacterData } from "../../../../engine/contracts/types/character";
import { behavioralInterpretationSourceHash } from "../../../../engine/generation/behavioral-interpretation";
import { CharacterBehaviorTab } from "./CharacterBehaviorTab";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = {
  name: "Mira",
  description: "A guarded courier who avoids direct answers about the missing letter.",
  personality: "Uses dry jokes to deflect personal questions.",
  scenario: "",
  first_mes: "",
  mes_example: "",
  creator_notes: "",
  system_prompt: "",
  post_history_instructions: "",
  tags: [],
  creator: "",
  character_version: "",
  alternate_greetings: [],
  extensions: {
    talkativeness: 0.5,
    fav: false,
    world: "",
    depth_prompt: { prompt: "", depth: 4, role: "system" },
    backstory: "",
    appearance: "",
  },
  character_book: null,
} satisfies CharacterData;

const profile = {
  version: 1,
  sourceHash: behavioralInterpretationSourceHash(data),
  status: "ready",
  enabled: true,
  claims: [
    {
      id: "claim-1",
      statement: "Mira may deflect personal questions with dry humor.",
      evidenceClass: "strongly_implied",
      evidence: [{ field: "personality", quote: "Uses dry jokes to deflect personal questions." }],
      source: "generated",
    },
  ],
} satisfies CharacterBehavioralInterpretation;

describe("CharacterBehaviorTab", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it("shows evidence and offers disable, regenerate, and correction controls", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root = createRoot(container!);
      root.render(<CharacterBehaviorTab data={data} profile={profile} onChange={onChange} />);
    });

    expect(container!.textContent).toContain("Mira may deflect personal questions");
    expect(container!.textContent).toContain("Uses dry jokes to deflect personal questions.");

    await act(async () =>
      container!.querySelector<HTMLButtonElement>('button[aria-label="Disable interpretation"]')!.click(),
    );
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));

    await act(async () =>
      container!.querySelector<HTMLButtonElement>('button[aria-label="Regenerate interpretation"]')!.click(),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "ready", enabled: true, regenerationRequested: true }),
    );

    const correction = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="Behavior correction"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        correction,
        "Mira answers directly when someone earns her trust.",
      );
      correction.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container!.querySelector<HTMLButtonElement>('button[aria-label="Add behavior correction"]')!.click(),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "ready",
        claims: expect.arrayContaining([
          expect.objectContaining({
            statement: "Mira answers directly when someone earns her trust.",
            source: "user_override",
          }),
        ]),
      }),
    );
  });
});
