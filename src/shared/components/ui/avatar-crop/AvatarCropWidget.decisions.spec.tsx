import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useEscapeOverlay } from "../../../hooks/use-escape-overlay";
import { mountScenario, type Replay } from "./avatar-crop-replay-harness";

const SRC = "https://img.test/a.png";
let replays: Replay[] = [];
let cleanups: Array<() => Promise<void>> = [];

async function mount() {
  const replay = await mountScenario({
    images: { [SRC]: { state: "loaded", w: 800, h: 1200 } },
    props: { src: SRC, alt: "Ava", crop: null },
    handsBack: true,
  });
  replays.push(replay);
  return replay;
}

afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  for (const replay of replays.reverse()) await replay.dispose();
  cleanups = [];
  replays = [];
});

const fullView = () => document.querySelector("[data-crop-full]");

async function pressEscape() {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => {
    document.body.dispatchEvent(event);
  });
  return event;
}

/** Another overlay opened on top of the full view. */
async function mountOtherOverlay() {
  let escapes = 0;
  function Other() {
    useEscapeOverlay(() => {
      escapes += 1;
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Other />));
  const unmount = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  cleanups.push(unmount);
  return { escapes: () => escapes };
}

describe("decision 1: the full view's close button has a type and a name", () => {
  it("is a type=button named Close full image, and closes the view", async () => {
    const widget = await mount();
    await widget.run({ do: "click", name: "Full image" });
    const close = fullView()!.querySelector("button")!;
    expect(close.getAttribute("type")).toBe("button");
    expect(close.getAttribute("aria-label")).toBe("Close full image");

    await widget.run({ do: "click", name: "closeFull" });
    expect(fullView()).toBeNull();
  });
});

describe("decision 2: Escape closes the full view when it is the topmost overlay", () => {
  it("closes the open view and marks the key handled", async () => {
    const widget = await mount();
    await widget.run({ do: "click", name: "Full image" });
    expect(fullView()).not.toBeNull();

    const escape = await pressEscape();
    expect(escape.defaultPrevented).toBe(true);
    expect(fullView()).toBeNull();
  });

  it("leaves the view open when another overlay is on top, and closes it once that one is gone", async () => {
    const widget = await mount();
    await widget.run({ do: "click", name: "Full image" });
    const other = await mountOtherOverlay();

    await pressEscape();
    expect(other.escapes()).toBe(1);
    expect(fullView()).not.toBeNull();

    await cleanups.pop()!();
    const escape = await pressEscape();
    expect(escape.defaultPrevented).toBe(true);
    expect(fullView()).toBeNull();
  });

  it("does not handle Escape while the view is closed", async () => {
    const widget = await mount();
    await widget.run({ do: "click", name: "Full image" });
    await widget.run({ do: "click", name: "fullBackdrop" });

    const escape = await pressEscape();
    expect(escape.defaultPrevented).toBe(false);
  });
});

describe("decision 3: icons are hidden from assistive tech", () => {
  it("hides the heading, header button and close button icons", async () => {
    const widget = await mount();
    await widget.run({ do: "click", name: "Full image" });
    const icons = [...widget.container.querySelectorAll("svg")];
    // Crop (heading), expand (Full image), rotate (Reset), X (close).
    expect(icons).toHaveLength(4);
    for (const icon of icons) expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(fullView()!.querySelector("button svg")).not.toBeNull();
  });
});
