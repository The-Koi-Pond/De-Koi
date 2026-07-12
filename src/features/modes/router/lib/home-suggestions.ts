export type HomeSuggestionDestination = "server-setup" | "sample-world" | "library-import" | "discover";

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
  "sample-world": {
    destination: "sample-world",
    label: "Explore sample world",
    description: "Tour a ready-made Game scene before connecting a model.",
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
  if (!context.hasLanguageModel) destinations.push("sample-world");
  if (context.libraryIsEmpty) destinations.push("library-import");
  if (context.hasActivity || destinations.length < 3) destinations.push("discover");

  return [...new Set(destinations)].slice(0, 3).map((destination) => suggestions[destination]);
}
