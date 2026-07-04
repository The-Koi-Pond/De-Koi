import type { LocalSidecarQuantization } from "../../../../engine/contracts/types/sidecar";

export function preferredCuratedQuantization(platform?: string, arch?: string): LocalSidecarQuantization {
  if (platform === "linux" && arch === "arm64") return "q4_k_m";

  return "q8_0";
}
