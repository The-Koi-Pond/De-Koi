const SAFE_MODE_VALUE = "customizations";

export function isCustomizationSafeMode(location: Pick<Location, "search">) {
  return new URLSearchParams(location.search).get("safe-mode") === SAFE_MODE_VALUE;
}

export function normalAppUrl(href: string) {
  const url = new URL(href);
  url.searchParams.delete("safe-mode");
  return `${url.pathname}${url.search}${url.hash}`;
}
