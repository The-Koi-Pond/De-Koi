export type DiscoveryMode = "conversation" | "roleplay" | "game";

export type DiscoveryChatDestination =
  | "chat-settings"
  | "chat-settings-continuity"
  | "slash-commands"
  | "prompt-inspector"
  | "message-actions"
  | "game-tutorial"
  | "game-journal"
  | "game-checkpoints"
  | "game-tools"
  | "roleplay-context";

export const DISCOVERY_APP_EVENT = "marinara:discovery-action";

export type DiscoveryAppEventDetail =
  | { type: "open-deki" }
  | { type: "go-home" }
  | { type: "open-help" }
  | { type: "open-discover" }
  | { type: "open-showcase"; showcaseId: "no-model-game-v1" }
  | { type: "open-mode-setup"; mode: DiscoveryMode }
  | { type: "open-chat-list" }
  | { type: "show-active-chat" }
  | { type: "open-chat-destination"; destination: DiscoveryChatDestination };
