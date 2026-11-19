import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Lets mocked replies, effects and animation frames finish. */
export async function settle(rounds = 4) {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

export interface Mounted {
  render: (node: ReactNode) => Promise<void>;
  unmount: () => Promise<void>;
}

export async function mount(node: ReactNode): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
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

function nameOf(element: Element): string {
  const label = element.getAttribute("aria-label");
  if (label) return label.trim();
  if (element.id) {
    const owner = Array.from(element.ownerDocument.querySelectorAll("label")).find(
      (label) => label.htmlFor === element.id,
    );
    if (owner) return (owner.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  const wrapping = element.closest("label");
  const source = element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? wrapping : element;
  if (!source) return "";
  const copy = source.cloneNode(true) as Element;
  copy.querySelectorAll("[aria-hidden='true']").forEach((hidden) => hidden.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

const ROLE_SELECTORS: Record<string, string> = {
  button: "button:not([role]), [role='button']",
  radio: "[role='radio'], input[type='radio']",
  checkbox: "input[type='checkbox']",
  textbox: "input[type='text'], textarea",
  combobox: "select",
  slider: "input[type='range']",
  dialog: "[role='dialog']",
  alert: "[role='alert']",
  status: "[role='status']",
  note: "[role='note']",
};

export function allByRole(role: string, name?: string | RegExp, scope: ParentNode = document.body): HTMLElement[] {
  const elements = Array.from(scope.querySelectorAll<HTMLElement>(ROLE_SELECTORS[role] ?? `[role='${role}']`));
  if (name === undefined) return elements;
  return elements.filter((element) => {
    const accessible = nameOf(element);
    return typeof name === "string" ? accessible === name : name.test(accessible);
  });
}

export function byRole<T extends HTMLElement = HTMLElement>(
  role: string,
  name?: string | RegExp,
  scope: ParentNode = document.body,
): T {
  const found = allByRole(role, name, scope);
  if (found.length !== 1) throw new Error(`Expected one ${role} named ${String(name)}, found ${found.length}`);
  return found[0] as T;
}

export function queryByRole(role: string, name?: string | RegExp, scope: ParentNode = document.body) {
  return allByRole(role, name, scope)[0] ?? null;
}

/** The dialog with that title. */
export function dialogNamed(title: string | RegExp): HTMLElement {
  const dialogs = allByRole("dialog").filter((dialog) => {
    const heading = dialog.querySelector("h2")?.textContent?.trim() ?? "";
    return typeof title === "string" ? heading === title : title.test(heading);
  });
  if (dialogs.length !== 1) throw new Error(`Expected one dialog titled ${String(title)}, found ${dialogs.length}`);
  return dialogs[0];
}

export async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await settle();
}

export async function changeValue(element: HTMLElement, value: string) {
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
  await settle(1);
}

/** Moves focus out of an element (React's onBlur listens to focusout). */
export async function blur(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  await settle(1);
}

/** Picks a file in a file input. */
export async function pickFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

/**
 * A FileReader whose data URL carries the file's text as its "base64", so a file holding `fake:cell0` reads as
 * `data:image/png;base64,fake:cell0`, the label the recording uses for an uploaded picture.
 */
export class LabelFileReader {
  result: string | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(file: File) {
    void file.text().then((text) => {
      this.result = `data:${file.type};base64,${text}`;
      this.onload?.();
    });
  }
}
