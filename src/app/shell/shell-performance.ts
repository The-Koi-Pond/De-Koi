const LOW_POWER_HOSTS = new Set(["pi", "pi.local", "raspberrypi", "raspberrypi.local"]);

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function isLikelyLowPowerShellHost(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return LOW_POWER_HOSTS.has(normalized);
}

export function shouldUseLowPowerShellMode({ hostname, updateSlow }: { hostname: string; updateSlow: boolean }) {
  return updateSlow || isLikelyLowPowerShellHost(hostname);
}

export function syncShellRootAttributes(
  root: HTMLElement,
  { isPageActive, lowPowerShellMode }: { isPageActive: boolean; lowPowerShellMode: boolean },
) {
  root.dataset.deKoiPageActivity = isPageActive ? "active" : "inactive";
  if (lowPowerShellMode) root.dataset.deKoiShellPerformance = "low";
  else delete root.dataset.deKoiShellPerformance;
}
