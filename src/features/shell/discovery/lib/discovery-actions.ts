import type { DiscoveryAction, DiscoveryChatDestination, DiscoveryMode } from "../discovery-types";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { DISCOVERY_APP_EVENT, type DiscoveryAppEventDetail } from "../../../../shared/lib/discovery-navigation";
import { openBugReport } from "../../../../shared/lib/support-report";

function emitDiscoveryEvent(detail: DiscoveryAppEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DiscoveryAppEventDetail>(DISCOVERY_APP_EVENT, { detail }));
}

export function openDiscover() {
  emitDiscoveryEvent({ type: "open-discover" });
}

const DESTINATION_MODES: Partial<Record<DiscoveryChatDestination, readonly DiscoveryMode[]>> = {
  "slash-commands": ["conversation", "roleplay"],
  "game-tutorial": ["game"],
  "game-journal": ["game"],
  "game-checkpoints": ["game"],
  "game-tools": ["game"],
  "roleplay-context": ["roleplay"],
};

function modeLabel(mode: DiscoveryMode) {
  return mode === "roleplay" ? "Roleplay" : mode === "game" ? "Game" : "Conversation";
}

function destinationLabel(destination: DiscoveryChatDestination) {
  const labels: Record<DiscoveryChatDestination, string> = {
    "chat-settings": "Chat Settings",
    "chat-settings-continuity": "Chat Continuity",
    "slash-commands": "Slash Commands",
    "prompt-inspector": "Prompt Inspector",
    "message-actions": "Message Actions",
    "game-tutorial": "Game Tutorial",
    "game-journal": "Game Journal",
    "game-checkpoints": "Game Checkpoints",
    "game-tools": "Game Tools",
    "roleplay-context": "Roleplay Context",
  };
  return labels[destination];
}

export function getDiscoveryActionLabel(action: DiscoveryAction) {
  if (action.label) return action.label;
  switch (action.type) {
    case "open-panel":
      return "Open";
    case "open-settings":
      return "Open Settings";
    case "replay-onboarding":
      return "Replay Tutorial";
    case "open-deki":
      return "Open Deki-senpai";
    case "open-help":
      return "Open Help";
    case "report-bug":
      return "Report Bug";
    case "go-home":
      return "Go Home";
    case "open-mode-setup":
      return `Set up ${modeLabel(action.mode)}`;
    case "open-chat-destination":
      return `Open ${destinationLabel(action.destination)}`;
    case "open-chat-list":
      return "Choose a chat";
    case "show-active-chat":
      return "Show active chat";
    case "open-showcase":
      return "Explore Sample World";
  }
}

export type DiscoveryActionOutcome =
  | { status: "handled" }
  | { status: "blocked"; message: string; fallback: DiscoveryAction };

export function resolveDiscoveryAction(action: DiscoveryAction): DiscoveryActionOutcome {
  if (action.type !== "open-chat-destination") return { status: "handled" };

  const { activeChatId, activeChat } = useChatStore.getState();
  if (!activeChatId || !activeChat) {
    return {
      status: "blocked",
      message: `${destinationLabel(action.destination)} needs an active chat.`,
      fallback: { type: "open-chat-list", label: "Choose a chat" },
    };
  }

  const requiredModes = DESTINATION_MODES[action.destination];
  if (requiredModes && !requiredModes.includes(activeChat.mode as DiscoveryMode)) {
    const requiredMode = requiredModes[0];
    return {
      status: "blocked",
      message: `${destinationLabel(action.destination)} needs an active ${modeLabel(requiredMode)} chat.`,
      fallback: { type: "open-mode-setup", mode: requiredMode, label: `Set up ${modeLabel(requiredMode)}` },
    };
  }

  return { status: "handled" };
}

export function runDiscoveryAction(action: DiscoveryAction): DiscoveryActionOutcome {
  const outcome = resolveDiscoveryAction(action);
  if (outcome.status === "blocked") return outcome;
  const ui = useUIStore.getState();

  switch (action.type) {
    case "open-panel":
      ui.openRightPanel(action.panel);
      break;
    case "open-settings":
      ui.openRightPanel("settings");
      ui.setSettingsTab(action.tab);
      ui.setPendingSettingsDestination(action.destination ?? null);
      break;
    case "replay-onboarding":
      ui.setOnboardingTourOpen(true);
      break;
    case "open-deki":
      emitDiscoveryEvent({ type: "open-deki" });
      break;
    case "open-help":
      emitDiscoveryEvent({ type: "open-help" });
      break;
    case "report-bug":
      void openBugReport({
        source: "help-hub",
        reportText: "Bug report started from Discover. Add what happened below.",
      }).catch(() => undefined);
      break;
    case "go-home":
      useChatStore.getState().setActiveChatId(null);
      ui.closeAllDetails();
      ui.closeRightPanel();
      emitDiscoveryEvent({ type: "go-home" });
      break;
    case "open-mode-setup":
      emitDiscoveryEvent({ type: "open-mode-setup", mode: action.mode });
      break;
    case "open-chat-list":
      emitDiscoveryEvent({ type: "open-chat-list" });
      break;
    case "show-active-chat":
      emitDiscoveryEvent({ type: "show-active-chat" });
      break;
    case "open-chat-destination":
      emitDiscoveryEvent({ type: "open-chat-destination", destination: action.destination });
      break;
    case "open-showcase":
      emitDiscoveryEvent({ type: "open-showcase", showcaseId: action.showcaseId });
      break;
  }

  return outcome;
}
