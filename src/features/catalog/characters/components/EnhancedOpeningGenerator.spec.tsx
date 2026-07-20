import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterData } from "../../../../engine/contracts/types/character";
import type { SaveEnhancedOpeningAlternateInput } from "../lib/enhanced-opening-generation";
import { EnhancedOpeningGenerator } from "./EnhancedOpeningGenerator";

const apiMocks = vi.hoisted(() => ({
  listAvailable: vi.fn(async () => [{ id: "connection-1", name: "Default", provider: "openai" }]),
  selectDefaultTextConnectionId: vi.fn((_connections: unknown[]): string | null => "connection-1"),
  resolveDefaultTextConnectionId: vi.fn(async () => "connection-1"),
  stream: vi.fn(async function* (_request: unknown, _signal?: AbortSignal) {
    yield {
      type: "token",
      text: '*Mira raises the same ring of keys.* "{{user}}, east door or west?"',
    };
  }),
}));

vi.mock("../../../../shared/api/connection-catalog-api", () => ({
  connectionCatalogApi: {
    listAvailable: apiMocks.listAvailable,
    selectDefaultTextConnectionId: apiMocks.selectDefaultTextConnectionId,
    resolveDefaultTextConnectionId: apiMocks.resolveDefaultTextConnectionId,
  },
}));

vi.mock("../../../../shared/api/llm-api", () => ({
  llmApi: { stream: apiMocks.stream },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function characterData(overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    name: "Mira Vale",
    description: "The exacting keeper of a locked city archive.",
    personality: "Dry, observant, and protective of other people's choices.",
    scenario: "The archive after midnight.",
    first_mes:
      '*Mira stops beneath the brass EXIT sign and holds out a ring of keys.* "The east wing is open. {{user}}, which door do you want?"',
    mes_example: '<START>\n{{user}}: The red door.\n{{char}}: "Then stay close."',
    creator_notes: "",
    system_prompt: "Never write the user's decisions.",
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
      backstory: "Mira inherited the keys from a vanished mentor.",
      appearance: "Ink-stained gloves and a green coat.",
    },
    character_book: null,
    ...overrides,
  };
}

describe("EnhancedOpeningGenerator", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSaveAlternate: ReturnType<typeof vi.fn<(input: SaveEnhancedOpeningAlternateInput) => Promise<void>>>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    apiMocks.listAvailable.mockResolvedValue([{ id: "connection-1", name: "Default", provider: "openai" }]);
    apiMocks.selectDefaultTextConnectionId.mockReturnValue("connection-1");
    apiMocks.resolveDefaultTextConnectionId.mockResolvedValue("connection-1");
    apiMocks.stream.mockImplementation(async function* (_request: unknown, _signal?: AbortSignal) {
      yield {
        type: "token",
        text: '*Mira raises the same ring of keys.* "{{user}}, east door or west?"',
      };
    });
    onSaveAlternate = vi.fn<(input: SaveEnhancedOpeningAlternateInput) => Promise<void>>(async () => undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(data = characterData()) {
    await act(async () => {
      root.render(
        <EnhancedOpeningGenerator data={data} comment="Night-shift archive keeper" onSaveAlternate={onSaveAlternate} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function generate() {
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Generate improved alternate opening"]',
    );
    expect(button?.disabled).toBe(false);
    await act(async () => {
      button!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("generates an ephemeral side-by-side preview with concise reason tags", async () => {
    await render();
    await generate();

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Original");
    expect(dialog?.textContent).toContain("Candidate");
    expect(dialog?.textContent).toContain("agency");
    expect(dialog?.textContent).toContain("actionable opening");
    expect(apiMocks.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "connection-1",
        messages: expect.arrayContaining([
          expect.objectContaining({ content: expect.stringContaining("SOURCE OPENING") }),
        ]),
      }),
      expect.any(AbortSignal),
    );
    expect(onSaveAlternate).not.toHaveBeenCalled();
  });

  it("cancels without mutating character data and returns focus to the trigger", async () => {
    await render();
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Generate improved alternate opening"]',
    )!;
    trigger.focus();
    await generate();

    const cancel = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Cancel",
    );
    await act(async () => {
      cancel!.click();
      await Promise.resolve();
    });

    expect(onSaveAlternate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("retries from the same captured source snapshot", async () => {
    let attempt = 0;
    apiMocks.stream.mockImplementation(async function* (_request: unknown, _signal?: AbortSignal) {
      attempt += 1;
      yield {
        type: "token",
        text:
          attempt === 1
            ? '*Mira raises the same keys.* "{{user}}, east or west?"'
            : '*Mira turns the same keys in her palm.* "{{user}}, left door or right?"',
      };
    });
    await render();
    await generate();
    const firstRequest = apiMocks.stream.mock.calls[0]?.[0] as { messages: unknown[] };

    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    await act(async () => {
      retry!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const secondRequest = apiMocks.stream.mock.calls[1]?.[0] as { messages: unknown[] };

    expect(secondRequest.messages).toEqual(firstRequest.messages);
    expect(container.textContent).toContain("left door or right");
  });

  it("marks a preview stale after authored edits and requires regeneration before saving", async () => {
    await render();
    await generate();

    await render(characterData({ scenario: "A station platform at dawn." }));

    expect(container.textContent).toContain("The character changed after this preview was generated");
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Save as alternate",
    );
    expect(save?.disabled).toBe(true);

    const regenerate = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Regenerate from current",
    );
    await act(async () => {
      regenerate!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("The character changed after this preview was generated");
  });

  it("persists only after Save as alternate and keeps the preview open when saving fails", async () => {
    onSaveAlternate.mockRejectedValueOnce(new Error("Disk full"));
    await render();
    await generate();

    const save = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Save as alternate",
    );
    await act(async () => {
      save!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSaveAlternate).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.stringContaining("east door or west"),
        sourceFingerprint: expect.stringMatching(/^[a-f0-9]{8}$/),
      }),
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("Disk full");

    onSaveAlternate.mockResolvedValueOnce(undefined);
    await act(async () => {
      save!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSaveAlternate).toHaveBeenCalledTimes(2);
  });

  it("shows invalid provider output as a non-mutating error", async () => {
    apiMocks.stream.mockImplementationOnce(async function* (_request: unknown, _signal?: AbortSignal) {
      yield { type: "token", text: "{{user}} nods and walks through the door." };
    });
    await render();
    await generate();

    expect(container.textContent).toMatch(/user control/i);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(onSaveAlternate).not.toHaveBeenCalled();
  });

  it("disables generation with connection guidance when no text connection is available", async () => {
    apiMocks.listAvailable.mockResolvedValueOnce([]);
    apiMocks.selectDefaultTextConnectionId.mockReturnValueOnce(null);
    await render();

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Generate improved alternate opening"]',
    );
    expect(button?.disabled).toBe(true);
    expect(container.textContent).toContain("Add a text connection");
  });

  it("uses the accessible modal and shared coarse-pointer target contract", async () => {
    await render();
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Generate improved alternate opening"]',
    )!;
    expect(trigger.className).toContain("de-koi-control-target");
    await generate();

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(
      Array.from(dialog.querySelectorAll("button, select")).every(
        (control) =>
          control.className.includes("de-koi-control-target") || control.className.includes("de-koi-icon-target"),
      ),
    ).toBe(true);
  });
});
