import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupJourneyContextBanner } from "./SetupJourneyContextBanner";

describe("SetupJourneyContextBanner", () => {
  let host: HTMLDivElement;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; }); });
  afterEach(() => { host.remove(); vi.restoreAllMocks(); });

  it.each(["runtime", "connection"] as const)("returns focus from the %s owner to a stable checklist anchor", (owner) => {
    const anchor = document.createElement("div"); anchor.id = `setup-step-${owner}`; anchor.tabIndex = -1; document.body.append(anchor);
    const onReturn = vi.fn(); const root = createRoot(host);
    act(() => root.render(<SetupJourneyContextBanner owner={owner} mode="conversation" onReturn={onReturn} />));
    expect(host.textContent).toContain(owner === "runtime" ? "Connect your De-Koi server" : "Add a language model");
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(onReturn).toHaveBeenCalled(); expect(document.activeElement).toBe(anchor);
    act(() => root.unmount()); anchor.remove();
  });
});
