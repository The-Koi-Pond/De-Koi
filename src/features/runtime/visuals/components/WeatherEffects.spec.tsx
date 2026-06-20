import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeatherEffects } from "./WeatherEffects";

type RafCallback = FrameRequestCallback;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const canvasContextStub = {
  addColorStop: vi.fn(),
  arc: vi.fn(),
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  closePath: vi.fn(),
  createLinearGradient: vi.fn(() => canvasContextStub),
  createRadialGradient: vi.fn(() => canvasContextStub),
  ellipse: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  restore: vi.fn(),
  rotate: vi.fn(),
  save: vi.fn(),
  setTransform: vi.fn(),
  stroke: vi.fn(),
  translate: vi.fn(),
  fillStyle: "",
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  lineWidth: 1,
  strokeStyle: "",
} as unknown as CanvasRenderingContext2D;

describe("WeatherEffects", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let rafCallbacks: Map<number, RafCallback>;
  let nextFrameId: number;

  function setupAnimationEnvironment() {
    rafCallbacks = new Map<number, RafCallback>();
    nextFrameId = 1;
    vi.spyOn(window.HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContextStub);
    vi.spyOn(window.HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 360,
      height: 360,
      left: 0,
      right: 640,
      top: 0,
      width: 640,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      rafCallbacks.set(id, callback);
      return id;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      rafCallbacks.delete(id);
    });
    return { cancelAnimationFrame, hidden, requestAnimationFrame };
  }

  async function renderWeatherEffects() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<WeatherEffects weather="clear" timeOfDay="noon" />);
    });
  }

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  it("stops scheduling animation frames while the document is hidden and resumes when visible", async () => {
    const { cancelAnimationFrame, hidden, requestAnimationFrame } = setupAnimationEnvironment();
    await renderWeatherEffects();

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(rafCallbacks.has(1)).toBe(true);

    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(rafCallbacks.size).toBe(0);

    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(rafCallbacks.has(2)).toBe(true);
  });

  it("cancels the pending frame on unmount after visibility churn", async () => {
    const { cancelAnimationFrame, hidden, requestAnimationFrame } = setupAnimationEnvironment();
    await renderWeatherEffects();

    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(rafCallbacks.has(2)).toBe(true);

    act(() => {
      root?.unmount();
    });
    root = null;

    expect(cancelAnimationFrame).toHaveBeenLastCalledWith(2);
    expect(rafCallbacks.size).toBe(0);
  });

  it("does not queue duplicate frames during rapid visible events", async () => {
    const { hidden, requestAnimationFrame } = setupAnimationEnvironment();
    await renderWeatherEffects();

    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(rafCallbacks.has(1)).toBe(true);

    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(rafCallbacks.has(2)).toBe(true);
    expect(rafCallbacks.size).toBe(1);
  });
});
