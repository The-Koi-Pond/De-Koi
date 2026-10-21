import type { APIProvider } from "../../../../engine/contracts/types/connection";

/** One plain line under the provider grid so a first-timer can tell the options apart. */
export const PROVIDER_HINTS: Partial<Record<APIProvider, string>> = {
  openai: "Pay-as-you-go API key from platform.openai.com.",
  openai_chatgpt: "Uses your ChatGPT plan instead of an API key. Needs a Codex login on the De-Koi server.",
  anthropic: "Pay-as-you-go API key from console.anthropic.com.",
  claude_subscription: "Uses your Claude plan instead of an API key. Needs a Claude Code login on the De-Koi server.",
  google: "API key from Google AI Studio.",
  google_vertex: "Google Cloud project credentials. For advanced setups.",
  mistral: "API key from console.mistral.ai.",
  cohere: "API key from dashboard.cohere.com.",
  openrouter: "One API key for models from many companies.",
  nanogpt: "One API key for many models, pay per use.",
  xai: "API key from console.x.ai for Grok models.",
  custom: "Any OpenAI-compatible server, including local models like Ollama or LM Studio.",
  image_generation: "For making pictures, not chat replies.",
};

/** The name a connection gets when the Name box is left empty. */
export function defaultConnectionName(providerName: string, typed: string): string {
  return typed.trim() || providerName;
}

/** What the next screen asks for, so the hint never mentions a key for providers that don't use one. */
export function nextScreenNote(provider: APIProvider): string {
  if (provider === "claude_subscription" || provider === "openai_chatgpt")
    return "You pick a model on the next screen.";
  if (provider === "custom") return "You add the server address and model on the next screen.";
  return "You add the key and pick a model on the next screen.";
}
