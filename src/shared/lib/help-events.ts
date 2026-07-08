export const HELP_REQUEST_EVENT = "de-koi:help-request";

export function requestHelp() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HELP_REQUEST_EVENT));
}
