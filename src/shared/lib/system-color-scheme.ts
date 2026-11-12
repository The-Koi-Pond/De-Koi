/** The device's light/dark setting, for De-Koi's "Match system" color scheme. Dark when it can't be read. */
export function systemColorScheme(): "dark" | "light" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
