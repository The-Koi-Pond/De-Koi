import { lazy, type ReactNode } from "react";

const CharacterEditor = lazy(() =>
  import("../../features/catalog/characters/shell").then((module) => ({ default: module.CharacterEditor })),
);
const CharacterLibraryView = lazy(() =>
  import("../../features/catalog/characters/shell").then((module) => ({
    default: module.CharacterLibraryView,
  })),
);
const LorebookEditor = lazy(() =>
  import("../../features/catalog/lorebooks/shell").then((module) => ({ default: module.LorebookEditor })),
);
const PresetEditor = lazy(() =>
  import("../../features/catalog/presets/shell").then((module) => ({ default: module.PresetEditor })),
);
const ConnectionEditor = lazy(() =>
  import("../../features/shell/connections/shell").then((module) => ({
    default: module.ConnectionEditor,
  })),
);
const AgentEditor = lazy(() =>
  import("../../features/catalog/agents/shell").then((module) => ({ default: module.AgentEditor })),
);
const ToolEditor = lazy(() =>
  import("../../features/catalog/agents/shell").then((module) => ({ default: module.ToolEditor })),
);
const PersonaEditor = lazy(() =>
  import("../../features/catalog/personas/shell").then((module) => ({ default: module.PersonaEditor })),
);
const RegexScriptEditor = lazy(() =>
  import("../../features/catalog/regex-scripts/shell").then((module) => ({
    default: module.RegexScriptEditor,
  })),
);

export type DetailRouteState = {
  characterDetailId: string | null;
  characterLibraryOpen: boolean;
  lorebookDetailId: string | null;
  presetDetailId: string | null;
  connectionDetailId: string | null;
  agentDetailId: string | null;
  toolDetailId: string | null;
  personaDetailId: string | null;
  regexDetailId: string | null;
};

type DetailRoute = {
  isActive: (state: DetailRouteState) => boolean;
  render: () => ReactNode;
};

const DETAIL_ROUTES: DetailRoute[] = [
  { isActive: (state) => Boolean(state.regexDetailId), render: () => <RegexScriptEditor /> },
  { isActive: (state) => Boolean(state.personaDetailId), render: () => <PersonaEditor /> },
  { isActive: (state) => Boolean(state.toolDetailId), render: () => <ToolEditor /> },
  { isActive: (state) => Boolean(state.agentDetailId), render: () => <AgentEditor /> },
  { isActive: (state) => Boolean(state.connectionDetailId), render: () => <ConnectionEditor /> },
  { isActive: (state) => Boolean(state.presetDetailId), render: () => <PresetEditor /> },
  { isActive: (state) => Boolean(state.characterDetailId), render: () => <CharacterEditor /> },
  { isActive: (state) => state.characterLibraryOpen, render: () => <CharacterLibraryView /> },
  { isActive: (state) => Boolean(state.lorebookDetailId), render: () => <LorebookEditor /> },
];

export function getDetailRouteView(state: DetailRouteState): ReactNode | null {
  return DETAIL_ROUTES.find((route) => route.isActive(state))?.render() ?? null;
}
