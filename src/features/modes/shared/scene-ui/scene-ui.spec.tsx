import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { ConcludedSceneCard } from "./ConcludedSceneCard";
import { EndSceneBar, type EndSceneBarProps } from "./EndSceneBar";
import { activeSceneOfOrigin, SceneInProgressCard } from "./SceneInProgressCard";

vi.mock("../../../../shared/lib/app-dialogs", () => ({ showConfirmDialog: vi.fn() }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.mocked(showConfirmDialog).mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function button(name: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No "${name}" button; found ${container!.textContent}`);
  return found;
}

function hasButton(name: string): boolean {
  return Array.from(container!.querySelectorAll("button")).some((element) => element.textContent?.trim() === name);
}

function pending() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => (finish = resolve));
  return { promise, finish };
}

async function renderBar(props: Partial<EndSceneBarProps> = {}) {
  const handlers = {
    onBackToOrigin: vi.fn(),
    onConclude: vi.fn(async () => true),
    onDiscard: vi.fn(async () => true),
    onConvert: vi.fn(async () => true),
    ...props,
  };
  await act(async () => root!.render(<EndSceneBar {...handlers} />));
  return handlers;
}

describe("EndSceneBar", () => {
  it("asks before ending, announces the question, and saves once", async () => {
    const saving = pending();
    const handlers = await renderBar({ onConclude: vi.fn(() => saving.promise) });

    await act(async () => button("End scene").click());
    const question = container!.querySelector('[aria-live="polite"]');
    expect(question?.textContent).toBe("End and save summary?");
    await act(async () => button("Yes").click());

    expect(button("Saving...").disabled).toBe(true);
    expect(button("Saving...").title).toBe("Wait until the scene summary is saved.");
    await act(async () => button("Saving...").click());
    expect(handlers.onConclude).toHaveBeenCalledTimes(1);
    expect(button("Discard").disabled).toBe(true);
    expect(button("Convert").disabled).toBe(true);

    await act(async () => saving.finish());
  });

  it("closes the question on No", async () => {
    const handlers = await renderBar();

    await act(async () => button("End scene").click());
    await act(async () => button("No").click());

    expect(hasButton("End scene")).toBe(true);
    expect(handlers.onConclude).not.toHaveBeenCalled();
  });

  it("confirms a discard in the app dialog and shows progress until it finishes", async () => {
    const discarding = pending();
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    const handlers = await renderBar({ onDiscard: vi.fn(() => discarding.promise) });
    await act(async () => button("End scene").click());

    await act(async () => button("Discard").click());

    expect(showConfirmDialog).toHaveBeenCalledWith({
      title: "Discard this scene?",
      message: "This will permanently delete the scene without saving a summary or memory.",
      confirmLabel: "Discard",
      cancelLabel: "Keep scene",
      tone: "destructive",
    });
    expect(handlers.onDiscard).toHaveBeenCalledTimes(1);
    expect(container!.textContent).not.toContain("End and save summary?");
    expect(button("Discarding...").disabled).toBe(true);
    expect(button("End scene").disabled).toBe(true);
    expect(button("Convert").disabled).toBe(true);
    await act(async () => {
      button("End scene").click();
      button("Convert").click();
    });
    expect(handlers.onConclude).not.toHaveBeenCalled();
    expect(handlers.onConvert).not.toHaveBeenCalled();

    await act(async () => discarding.finish());
    expect(hasButton("Discard")).toBe(true);
  });

  it("keeps the scene when the discard is cancelled", async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    const handlers = await renderBar();

    await act(async () => button("Discard").click());

    expect(showConfirmDialog).toHaveBeenCalledOnce();
    expect(handlers.onDiscard).not.toHaveBeenCalled();
    expect(hasButton("Discarding...")).toBe(false);
  });

  it("confirms a convert and runs it", async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    const handlers = await renderBar();

    await act(async () => button("Convert").click());

    expect(showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Convert this scene into a standalone roleplay?",
        confirmLabel: "Convert",
        cancelLabel: "Cancel",
        tone: "destructive",
      }),
    );
    expect(handlers.onConvert).toHaveBeenCalledTimes(1);
  });

  it("disables Convert while a reply streams or a copy runs, and while the scene is ending", async () => {
    await renderBar({ isStreaming: true });
    expect(button("Convert").disabled).toBe(true);
    expect(button("Convert").title).toBe("Wait for the reply to finish.");

    await renderBar({ isForking: true });
    expect(button("Convert").disabled).toBe(true);

    const saving = pending();
    await renderBar({ onConclude: vi.fn(() => saving.promise) });
    await act(async () => button("End scene").click());
    await act(async () => button("Yes").click());
    expect(button("Convert").disabled).toBe(true);
    await act(async () => saving.finish());
  });

  it("goes back to the conversation, and hides that without an origin", async () => {
    const handlers = await renderBar();
    act(() => button("Back to conversation").click());
    expect(handlers.onBackToOrigin).toHaveBeenCalled();

    await renderBar({ onBackToOrigin: undefined });
    expect(hasButton("Back to conversation")).toBe(false);
  });
});

describe("ConcludedSceneCard", () => {
  it("shows the scene and offers Reopen scene", async () => {
    const onReopen = vi.fn(async () => true);
    const onBackToOrigin = vi.fn();
    await act(async () =>
      root!.render(
        <ConcludedSceneCard description="A flooded archive." onBackToOrigin={onBackToOrigin} onReopen={onReopen} />,
      ),
    );

    expect(container!.textContent).toContain("Scene");
    expect(container!.querySelector(".italic")?.textContent).toBe("A flooded archive.");
    await act(async () => button("Reopen scene").click());
    act(() => button("Back to conversation").click());

    expect(onReopen).toHaveBeenCalledTimes(1);
    expect(onBackToOrigin).toHaveBeenCalled();
  });
});

describe("SceneInProgressCard", () => {
  it("names the scene and goes to it", async () => {
    const onGoToScene = vi.fn();
    await act(async () => root!.render(<SceneInProgressCard sceneName="Scene: Pier" onGoToScene={onGoToScene} />));

    expect(container!.textContent).toContain("A scene is in progress");
    expect(container!.textContent).toContain("Scene: Pier");
    act(() => button("Go to scene").click());
    expect(onGoToScene).toHaveBeenCalled();
  });

  it("shows only for the origin's active scene while it is active", () => {
    const related = [
      { id: "scene", name: "Scene: Pier", metadata: JSON.stringify({ sceneStatus: "active" }) },
      { id: "done", name: "Scene: Old", metadata: { sceneStatus: "concluded" } },
    ];

    expect(activeSceneOfOrigin({ activeSceneChatId: "scene" }, related)).toEqual({
      chatId: "scene",
      name: "Scene: Pier",
    });
    expect(activeSceneOfOrigin({ activeSceneChatId: "done" }, related)).toBeNull();
    expect(activeSceneOfOrigin({ activeSceneChatId: "missing" }, related)).toBeNull();
    expect(activeSceneOfOrigin({}, related)).toBeNull();
  });
});
