import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface SentRequest {
  command: "bot_browser_get" | "bot_browser_post";
  path: string;
  body?: unknown;
}

/** Waits for timers and promises the screen started (debounced searches, mocked replies). */
export async function settle(ms = 25) {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }
}

export interface Mounted {
  container: HTMLDivElement;
  queryClient: QueryClient;
  unmount: () => Promise<void>;
}

export async function mount(node: ReactNode): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  });
  return {
    container,
    queryClient,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/** Elements whose accessible name is their text (or aria-label), for buttons, links and the like. */
function nameOf(element: Element): string {
  const label = element.getAttribute("aria-label");
  if (label) return label.trim();
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll("[aria-hidden='true']").forEach((hidden) => hidden.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function getAllByRole(role: string, name?: string | RegExp, scope: ParentNode = document.body): HTMLElement[] {
  const implicit: Record<string, string> = {
    button: "button:not([role]), [role='button']",
    link: "a[href]",
    combobox: "select",
    textbox: "input:not([type]), input[type='text'], input[type='search'], input[type='number'], textarea",
    checkbox: "input[type='checkbox']",
    radio: "input[type='radio']",
    dialog: "[role='dialog']",
    switch: "[role='switch']",
    menuitem: "[role='menuitem']",
    menuitemradio: "[role='menuitemradio']",
    alert: "[role='alert']",
    status: "[role='status']",
    note: "[role='note']",
  };
  const selector = implicit[role] ?? `[role='${role}']`;
  const elements = Array.from(scope.querySelectorAll<HTMLElement>(selector));
  if (name === undefined) return elements;
  return elements.filter((element) => {
    const accessible = nameOf(element);
    return typeof name === "string" ? accessible === name : name.test(accessible);
  });
}

export function getByRole(role: string, name?: string | RegExp, scope: ParentNode = document.body): HTMLElement {
  const found = getAllByRole(role, name, scope);
  if (found.length !== 1) throw new Error(`Expected one ${role} named ${String(name)}, found ${found.length}`);
  return found[0];
}

export function queryByRole(role: string, name?: string | RegExp, scope: ParentNode = document.body) {
  return getAllByRole(role, name, scope)[0] ?? null;
}

export function byPlaceholder<T extends HTMLElement = HTMLInputElement>(prefix: string): T {
  const element = Array.from(document.body.querySelectorAll<T>("[placeholder]")).find((item) =>
    item.getAttribute("placeholder")?.startsWith(prefix),
  );
  if (!element) throw new Error(`No field with a placeholder starting "${prefix}"`);
  return element;
}

export function labelledField<T extends HTMLElement>(labelText: string, scope: ParentNode = document.body): T {
  const label = Array.from(scope.querySelectorAll("label")).find((item) =>
    (item.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(labelText),
  );
  const field = label?.querySelector<T>("input, select, textarea");
  if (!field) throw new Error(`No field labelled "${labelText}"`);
  return field;
}

export async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

export async function changeValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

export async function pressKey(element: Element, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** A path with its query parameters sorted, so two paths compare regardless of parameter order. */
export function normalizedPath(path: string): string {
  const [base, query] = path.split("?", 2);
  if (query === undefined) return base;
  const params = Array.from(new URLSearchParams(query).entries()).sort(([left], [right]) => left.localeCompare(right));
  return `${base}?${new URLSearchParams(params).toString()}`;
}

/** A 1×1 PNG, the smallest picture a card file can carry. */
export const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export function tinyPngBytes(): Uint8Array {
  const binary = atob(TINY_PNG_BASE64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** An IntersectionObserver that never reports, so lazy card pictures stay unloaded in tests. */
export class QuietIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
}
