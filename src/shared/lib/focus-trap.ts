// Keeps Tab and Shift+Tab inside a modal window, so keyboard focus never reaches the page behind it.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface TabKeyEvent {
  key: string;
  shiftKey: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

/** Call from the window's keydown handler. A nested window that already wrapped focus wins. */
export function keepTabInside(event: TabKeyEvent, container: HTMLElement | null) {
  if (event.key !== "Tab" || event.defaultPrevented || !container) return;

  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;

  const active = document.activeElement;
  // From the window itself (focused when it opens), the browser's next step would leave the window.
  if (active === container || !container.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
