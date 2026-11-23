// The tab's props and reading a stored section row (docs/provenance/preset-sections.md, "Props" and "Reading a
// row"). Rows come from storage as stored, so any field can be missing or odd.
import type { PromptGroup, WrapFormat } from "../../../../../engine/contracts/types/prompt";
import type {
  useCreateGroup,
  useCreateSection,
  useDeleteGroup,
  useDeleteSection,
  useReorderSections,
  useUpdateGroup,
  useUpdateSection,
} from "../../hooks/use-presets";
import type { PresetVariablesEditorProps } from "../preset-variables/variable-row";

/** A prompt section as storage holds it. */
export interface SectionRow {
  id: string;
  identifier?: unknown;
  name?: unknown;
  content?: unknown;
  role?: unknown;
  enabled?: unknown;
  isMarker?: unknown;
  forbidOverrides?: unknown;
  groupId?: unknown;
  markerConfig?: unknown;
  injectionPosition?: unknown;
  injectionDepth?: unknown;
  injectionOrder?: unknown;
}

/** The contract with `PresetEditor.tsx`. */
export interface PresetSectionsTabProps {
  presetId: string;
  /** The preset's sections in `sectionOrder` order. */
  sections: SectionRow[];
  /** The preset's groups by id, in stored order. */
  groupMap: Map<string, PromptGroup>;
  choiceBlocks: PresetVariablesEditorProps["variables"];
  /** Accepted and not used. */
  wrapFormat: WrapFormat;
  onCreateSection: Pick<ReturnType<typeof useCreateSection>, "mutate" | "mutateAsync" | "isPending">;
  onUpdateSection: Pick<ReturnType<typeof useUpdateSection>, "mutate">;
  onDeleteSection: Pick<ReturnType<typeof useDeleteSection>, "mutate">;
  onReorderSections: Pick<ReturnType<typeof useReorderSections>, "mutate" | "mutateAsync" | "isPending">;
  onCreateGroup: Pick<ReturnType<typeof useCreateGroup>, "mutate">;
  onUpdateGroup: Pick<ReturnType<typeof useUpdateGroup>, "mutate">;
  onDeleteGroup: Pick<ReturnType<typeof useDeleteGroup>, "mutate">;
  onCreateVariable: PresetVariablesEditorProps["onCreateVariable"];
  onUpdateVariable: PresetVariablesEditorProps["onUpdateVariable"];
  onDeleteVariable: PresetVariablesEditorProps["onDeleteVariable"];
  onReorderVariables: PresetVariablesEditorProps["onReorderVariables"];
  hasLorebookMarker: boolean;
  parentChatHasLorebook: boolean;
}

/** On only for `true` or the string `"true"`. */
export function isOn(value: unknown): boolean {
  return value === true || value === "true";
}

/** The marker types in label order. */
export const MARKER_TYPES = [
  ["character", "Character Info"],
  ["lorebook", "Lorebook Marker (All)"],
  ["persona", "Persona"],
  ["chat_history", "Chat History"],
  ["chat_summary", "Chat Summary"],
  ["world_info_before", "Lorebook Marker (Before)"],
  ["world_info_after", "Lorebook Marker (After)"],
  ["dialogue_examples", "Dialogue Examples"],
  ["agent_data", "Agent Data"],
] as const;

export function markerLabel(type: string): string {
  return MARKER_TYPES.find(([known]) => known === type)?.[1] ?? "Unknown";
}

export const LOREBOOK_MARKER_TYPES = ["lorebook", "world_info_before", "world_info_after"];

/** A marker config as read: an object, or JSON text parsed to one, with a text `type`; anything else is none. */
export type MarkerConfigView = Record<string, unknown> & { type: string };

export function readMarkerConfig(value: unknown): MarkerConfigView | null {
  let config = value;
  if (typeof config === "string") {
    try {
      config = JSON.parse(config);
    } catch {
      return null;
    }
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) return null;
  const record = config as Record<string, unknown>;
  return typeof record.type === "string" ? (record as MarkerConfigView) : null;
}

/** The `{{agent::…}}` macro of an agent marker (`agent` only when the type is missing or `null`). */
export function agentMacro(config: MarkerConfigView): string {
  return `{{agent::${(config.agentType as string | null | undefined) ?? "agent"}}}`;
}

export interface SectionView {
  on: boolean;
  marker: boolean;
  /** The role as stored, `system` when missing or `null` (an unknown role stays as it is). */
  role: string;
  config: MarkerConfigView | null;
  group: PromptGroup | undefined;
}

export function readSection(section: SectionRow, groupMap: Map<string, PromptGroup>): SectionView {
  return {
    on: isOn(section.enabled),
    marker: isOn(section.isMarker),
    role: (section.role as string | null | undefined) ?? "system",
    config: readMarkerConfig(section.markerConfig),
    group: section.groupId ? groupMap.get(section.groupId as string) : undefined,
  };
}
