import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemePreview } from "./ThemePreview";

describe("ThemePreview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("contains destructive draft CSS inside a sandboxed iframe", () => {
    act(() => root.render(<ThemePreview enabled css={'button { display: none !important; }'} />));

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("");
    expect(iframe?.getAttribute("srcdoc")).toContain("display: none");
    expect(document.head.textContent).not.toContain("display: none");
  });

  it("renders a disabled explanation without building a preview document", () => {
    act(() => root.render(<ThemePreview enabled={false} css=":root { --primary: red; }" />));

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Preview is off");
  });
});
