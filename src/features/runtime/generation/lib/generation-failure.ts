import { useUIStore } from "../../../../shared/stores/ui.store";

// Error codes raised by provider transport (src-tauri/crates/llm) and the
// connection checks. Their messages already name the fix; this only decides
// whether to offer a shortcut to Connections.
const PROVIDER_ERROR_CODE = /^(llm_|models_|connection_|openai_chatgpt_|claude_subscription_)/;

function readCode(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

export function isProviderFailure(error: unknown): boolean {
  const details = error && typeof error === "object" ? (error as { details?: unknown }).details : undefined;
  return PROVIDER_ERROR_CODE.test(readCode(error) || readCode(details));
}

export function openConnectionsPanel(): void {
  useUIStore.getState().openRightPanel("connections");
}
