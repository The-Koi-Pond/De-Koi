export const DISCOVERY_APP_EVENT = "marinara:discovery-action";

export type DiscoveryAppEventDetail =
  | {
      type: "open-deki";
    }
  | {
      type: "go-home";
    }
  | {
      type: "open-help";
    }
  | {
      type: "open-discover";
    }
  | {
      type: "open-showcase";
      showcaseId: "no-model-game-v1";
    };
