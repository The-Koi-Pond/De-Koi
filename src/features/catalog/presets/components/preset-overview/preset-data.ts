// What the shell reads from the loaded preset and the active chat (docs/provenance/preset-overview.md, "Data"). Rows
// come from storage as stored, so every field can be missing or odd.
import type { PromptPreset, PromptSection } from "../../../../../engine/contracts/types/prompt";
import { isOn, LOREBOOK_MARKER_TYPES, readMarkerConfig, type SectionRow } from "../preset-sections/section-row";

/**
 * The Overview fields the shell edits and Save sends. Values are kept as stored (a number stays a number) until the
 * person types over them; the schema decides at save time what it accepts.
 */
export interface PresetDraft {
  name: unknown;
  description: unknown;
  wrapFormat: unknown;
  author: unknown;
  parameters: unknown;
}

export const EMPTY_DRAFT: PresetDraft = { name: "", description: "", wrapFormat: "xml", author: "", parameters: {} };

/** The draft a freshly loaded preset row starts from. */
export function draftFromPreset(preset: PromptPreset): PresetDraft {
  const row = preset as unknown as Record<string, unknown>;
  return {
    name: row.name ?? "",
    description: row.description ?? "",
    wrapFormat: row.wrapFormat ?? "xml",
    author: row.author ?? "",
    parameters: row.parameters ?? {},
  };
}

/** `sectionOrder` mapped to section rows: anything but a list is empty, unknown ids are left out, repeats repeat. */
export function orderedSections(preset: PromptPreset, sections: PromptSection[]): SectionRow[] {
  const order = (preset as unknown as Record<string, unknown>).sectionOrder;
  if (!Array.isArray(order)) return [];
  const byId = new Map(sections.map((section) => [section.id, section as unknown as SectionRow]));
  return order.flatMap((id: unknown) => {
    const section = byId.get(id as string);
    return section ? [section] : [];
  });
}

/** Some ordered section is an enabled marker whose config is a lorebook marker. */
export function hasLorebookMarker(sections: SectionRow[]): boolean {
  return sections.some((section) => {
    if (!isOn(section.enabled) || !isOn(section.isMarker)) return false;
    const config = readMarkerConfig(section.markerConfig);
    return !!config && LOREBOOK_MARKER_TYPES.includes(config.type);
  });
}

/** The chat's `metadata` (an object, or JSON text) has a non-empty `activeLorebookIds` list. */
export function chatHasLorebooks(chat: unknown): boolean {
  if (typeof chat !== "object" || chat === null) return false;
  let metadata = (chat as { metadata?: unknown }).metadata;
  if (typeof metadata === "string") {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return false;
    }
  }
  if (typeof metadata !== "object" || metadata === null) return false;
  const ids = (metadata as { activeLorebookIds?: unknown }).activeLorebookIds;
  return Array.isArray(ids) && ids.length > 0;
}
