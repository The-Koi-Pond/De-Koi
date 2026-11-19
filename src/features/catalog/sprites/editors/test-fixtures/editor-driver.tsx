import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

// A small DOM driver for the editors' jsdom tests: mount, find by role and accessible name, click, type, point.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Lets promises, effects and timers settle. */
export async function settle(rounds = 3) {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

export async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = async (next: ReactNode) => {
    await act(async () => root.render(next));
    await settle();
  };
  await render(node);
  return {
    render,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function accessibleName(element: Element): string {
  const label = element.getAttribute("aria-label");
  if (label) return label.trim();
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) return (document.getElementById(labelledBy)?.textContent ?? "").replace(/\s+/g, " ").trim();
  if (element.id) {
    const owner = Array.from(document.querySelectorAll("label")).find((label) => label.htmlFor === element.id);
    if (owner) return (owner.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll("[aria-hidden='true']").forEach((hidden) => hidden.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

const ROLE_SELECTORS: Record<string, string> = {
  button: "button",
  checkbox: "input[type='checkbox']",
  slider: "input[type='range']",
  dialog: "[role='dialog']",
  alert: "[role='alert']",
  status: "[role='status']",
  group: "[role='group']",
  heading: "h1, h2, h3",
  region: "section[aria-labelledby]",
  img: "img",
};

export function allByRole(role: string, name?: string, scope: ParentNode = document.body): HTMLElement[] {
  const elements = Array.from(scope.querySelectorAll<HTMLElement>(ROLE_SELECTORS[role]));
  return name === undefined ? elements : elements.filter((element) => accessibleName(element) === name);
}

export function byRole<T extends HTMLElement = HTMLElement>(role: string, name?: string, scope?: ParentNode): T {
  const found = allByRole(role, name, scope);
  if (found.length !== 1) throw new Error(`Expected one ${role} named ${String(name)}, found ${found.length}`);
  return found[0] as T;
}

export function byLabel<T extends HTMLElement = HTMLElement>(label: string, scope: ParentNode = document.body): T {
  const found = Array.from(scope.querySelectorAll<HTMLElement>("[aria-label]")).filter(
    (element) => element.getAttribute("aria-label") === label,
  );
  if (found.length !== 1) throw new Error(`Expected one element labelled ${label}, found ${found.length}`);
  return found[0] as T;
}

export async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Sets an input's value the way a person would, so React sees the change. */
export async function changeValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(1);
}

export async function pressKey(key: string, options: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await settle(1);
  return event;
}

export async function pointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointerleave",
  at: { x: number; y: number },
  button = 0,
) {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button, pointerId: 1 }),
    );
  });
}

/**
 * jsdom has no layout or pointer capture: the canvas is shown at 1 px per picture pixel from (0, 0) and the stage is
 * 1000 × 700 px, so a small picture fits at 100%.
 */
export function stubLayout(width: number, height: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 700 });
  HTMLCanvasElement.prototype.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
}
