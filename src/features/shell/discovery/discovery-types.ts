import type { Panel } from "../../../shared/stores/ui.store";
import type { SettingsDestinationId, SettingsTabId } from "../settings/discovery";
import type { DiscoveryChatDestination, DiscoveryMode } from "../../../shared/lib/discovery-navigation";

export type { DiscoveryChatDestination, DiscoveryMode } from "../../../shared/lib/discovery-navigation";

export const DISCOVERY_CATEGORIES = [
  "Getting started",
  "Chat modes",
  "Library",
  "Agents",
  "Media",
  "Settings",
  "Advanced",
  "Help",
] as const;

export const DISCOVERY_COVERAGE = ["core", "advanced", "experimental", "needs-polish"] as const;

export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number];
export type DiscoveryCoverage = (typeof DISCOVERY_COVERAGE)[number];
export type DiscoveryPanelTarget = Exclude<Panel, "chat">;

export type DiscoveryAction =
  | {
      type: "open-panel";
      panel: DiscoveryPanelTarget;
      label?: string;
    }
  | {
      type: "open-settings";
      tab: SettingsTabId;
      destination?: SettingsDestinationId;
      label?: string;
    }
  | {
      type: "replay-onboarding";
      label?: string;
    }
  | {
      type: "open-deki";
      label?: string;
    }
  | {
      type: "open-help";
      label?: string;
    }
  | {
      type: "report-bug";
      label?: string;
    }
  | {
      type: "go-home";
      label?: string;
    }
  | {
      type: "open-mode-setup";
      mode: DiscoveryMode;
      label?: string;
    }
  | {
      type: "open-chat-destination";
      destination: DiscoveryChatDestination;
      label?: string;
    }
  | {
      type: "open-chat-list";
      label?: string;
    }
  | {
      type: "show-active-chat";
      label?: string;
    }
  | {
      type: "open-showcase";
      showcaseId: "no-model-game-v1";
      label?: string;
    };

export interface DiscoveryEntry {
  id: string;
  title: string;
  category: DiscoveryCategory;
  summary: string;
  keywords: string[];
  audience: string;
  where: string;
  actions: DiscoveryAction[];
  coverage: DiscoveryCoverage;
}
