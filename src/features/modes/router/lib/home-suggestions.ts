export type HomeSuggestionDestination = "server-setup" | "connect-model" | "library-import" | "discover";

export interface HomeSuggestion {
  destination: HomeSuggestionDestination;
  label: string;
  description: string;
}

export interface HomeSuggestionContext {
  needsServerSetup: boolean;
  hasLanguageModel: boolean;
  libraryIsEmpty: boolean;
  hasActivity: boolean;
}

const suggestions: Record<HomeSuggestionDestination, HomeSuggestion> = {
  "server-setup": {
    destination: "server-setup",
    label: "Connect to your De-Koi server",
    description: "Finish web setup so your library and chats have somewhere to live.",
  },
  "connect-model": {
    destination: "connect-model",
    label: "Add a model connection",
    description: "Connect an AI provider or a local model so characters can reply.",
  },
  "library-import": {
    destination: "library-import",
    label: "Import your library",
    description: "Bring in characters, personas, lorebooks, and presets.",
  },
  discover: {
    destination: "discover",
    label: "Open Discover",
    description: "Find more ways to shape chats, worlds, and your workspace.",
  },
};

export function getHomeSuggestions(context: HomeSuggestionContext): HomeSuggestion[] {
  const destinations: HomeSuggestionDestination[] = [];
  if (context.needsServerSetup) destinations.push("server-setup");
  if (!context.hasLanguageModel) destinations.push("connect-model");
  if (context.libraryIsEmpty) destinations.push("library-import");
  if (context.hasActivity || destinations.length < 3) destinations.push("discover");

  return [...new Set(destinations)].slice(0, 3).map((destination) => suggestions[destination]);
}
