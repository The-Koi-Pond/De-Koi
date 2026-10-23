import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { RoleplayWorldTickState, WorldTickOffer } from "../../../../engine/contracts/types/roleplay-world-tick";
import { normalizeWorldTickState } from "../../../../engine/modes/roleplay/world-tick/world-tick-state";
import { RoleplayWorldTickModal } from "./RoleplayWorldTickModal";
import { RoleplayWorldTickOfferBar } from "./RoleplayWorldTickOfferBar";

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  propose: vi.fn(),
  apply: vi.fn(),
  hook: {} as Record<string, unknown>,
}));

vi.mock("../hooks/use-world-tick", () => ({ useWorldTick: () => mocks.hook }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const NOW = "2026-10-23T12:00:00.000Z";
const sceneOffer: WorldTickOffer = {
  id: "scene:scene-1:m9",
  trigger: "scene_concluded",
  elapsed: "",
  label: "Night at the Bridge",
  createdAt: NOW,
};
const skipOffer: WorldTickOffer = {
  id: "time_skip:m2:three days later",
  trigger: "time_skip",
  elapsed: "three days",
  label: "Three days later",
  createdAt: NOW,
};

function stateWith(patch: Partial<RoleplayWorldTickState>): RoleplayWorldTickState {
  return { ...normalizeWorldTickState(null, NOW), revision: 3, ...patch };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = vi.fn();
});

afterEach(async () => {
  mocks.command.mockReset();
  mocks.propose.mockReset();
  mocks.apply.mockReset();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function render(node: React.ReactNode, state: RoleplayWorldTickState) {
  mocks.hook = {
    state,
    isLoading: false,
    error: null,
    command: { mutate: mocks.command, isPending: false },
    propose: { mutate: mocks.propose, isPending: false },
    apply: { mutate: mocks.apply, isPending: false },
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
    await Promise.resolve();
  });
  return document.body;
}

function button(element: ParentNode, text: string): HTMLButtonElement {
  const found = [...element.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === text);
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

describe("world-tick offer bar", () => {
  it("names the boundary and opens the review without suggesting anything itself", async () => {
    const onOpen = vi.fn();
    const element = await render(
      <RoleplayWorldTickOfferBar chatId="chat-1" offer={sceneOffer} onOpen={onOpen} />,
      stateWith({ offer: sceneOffer }),
    );

    expect(element.textContent).toContain("“Night at the Bridge” ended. Let time pass before the story picks up?");
    await act(async () => button(element, "Let time pass").click());
    expect(onOpen).toHaveBeenCalledOnce();
    expect(mocks.propose).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("can be dismissed or switched off for the chat", async () => {
    const element = await render(
      <RoleplayWorldTickOfferBar chatId="chat-1" offer={skipOffer} onOpen={vi.fn()} />,
      stateWith({ offer: skipOffer }),
    );

    await act(async () => element.querySelector<HTMLButtonElement>('button[aria-label="Not now"]')!.click());
    expect(mocks.command).toHaveBeenLastCalledWith(
      { command: { type: "dismiss_offer", offerId: skipOffer.id } },
      expect.anything(),
    );

    await act(async () => button(element, "Don't offer here").click());
    expect(mocks.command).toHaveBeenLastCalledWith(
      { command: { type: "set_offers_enabled", enabled: false } },
      expect.anything(),
    );
  });
});

describe("Let time pass with an offer waiting", () => {
  it("prefills the skipped time and takes the offer when suggesting", async () => {
    const element = await render(
      <RoleplayWorldTickModal chatId="chat-1" open onClose={vi.fn()} latestMessageId="m3" replyInProgress={false} />,
      stateWith({ offer: skipOffer }),
    );

    expect(element.textContent).toContain("You skipped ahead (Three days later).");
    expect(element.querySelector<HTMLInputElement>('input[aria-label="How much time passes"]')!.value).toBe(
      "three days",
    );
    await act(async () => button(element, "Suggest what happens").click());
    expect(mocks.propose).toHaveBeenCalledWith(
      { elapsed: "three days", guidance: "", offerId: skipOffer.id },
      expect.anything(),
    );
  });

  it("has the per-chat switch", async () => {
    const element = await render(
      <RoleplayWorldTickModal chatId="chat-1" open onClose={vi.fn()} latestMessageId="m3" replyInProgress={false} />,
      stateWith({ offersEnabled: false }),
    );

    const toggle = element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(toggle.checked).toBe(false);
    await act(async () => toggle.click());
    expect(mocks.command).toHaveBeenCalledWith(
      { command: { type: "set_offers_enabled", enabled: true }, expectedRevision: 3 },
      expect.anything(),
    );
  });
});
