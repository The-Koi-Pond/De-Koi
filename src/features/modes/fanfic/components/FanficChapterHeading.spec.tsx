import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FanficChapterHeading } from "./FanficChapterHeading";

const writtenBy = (...models: Array<{ connectionId: string; name: string; model: string }>) => ({
  fanficVersion: { models, origin: { kind: "chapter", notes: "" }, unfinished: null },
});
const WRITER = { connectionId: "conn-a", name: "Writer", model: "big-model" };
const DRAFTER = { connectionId: "conn-b", name: "Drafter", model: "small-model" };

describe("FanficChapterHeading", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
  });

  function render(extra: unknown) {
    act(() => {
      root ??= createRoot(container);
      root.render(<FanficChapterHeading id="fanfic-ch-3" heading="Chapter 3: Thaw" extra={extra} />);
    });
  }

  it("shows the model that wrote the chapter under its heading", () => {
    render(writtenBy(WRITER));

    expect(container.querySelector("h3")?.textContent).toBe("Chapter 3: Thaw");
    expect(container.textContent).toContain("Written by Writer • big-model");
  });

  it("shows every model that wrote part of the chapter, in order", () => {
    render(writtenBy(WRITER, WRITER, DRAFTER));

    expect(container.textContent).toContain("Written by Writer • big-model → Drafter • small-model");
  });

  it("shows the models of the version on screen", () => {
    render(writtenBy(WRITER));
    render(writtenBy(DRAFTER));

    expect(container.textContent).toContain("Written by Drafter • small-model");
    expect(container.textContent).not.toContain("Writer");
  });

  it("shows only the heading for a chapter written before models were recorded", () => {
    render({ generationInfo: { model: "big-model" } });

    expect(container.textContent).toBe("Chapter 3: Thaw");
  });
});
