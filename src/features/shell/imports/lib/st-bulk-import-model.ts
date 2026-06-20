export interface STBulkScanItemBase {
  id: string;
  path: string;
  name: string;
  modifiedAt: string | null;
}

export interface STBulkScanResult {
  success: boolean;
  error?: string;
  dataDir?: string;
  characters: Array<STBulkScanItemBase & { format: string }>;
  chats: Array<STBulkScanItemBase & { characterName: string; folderName: string }>;
  groupChats: Array<STBulkScanItemBase & { groupName: string; members: string[] }>;
  presets: Array<STBulkScanItemBase & { isBuiltin?: boolean }>;
  lorebooks: STBulkScanItemBase[];
  backgrounds: STBulkScanItemBase[];
  personas: Array<STBulkScanItemBase & { description: string }>;
}

export interface STBulkImportedCounts {
  characters: number;
  chats: number;
  groupChats: number;
  presets: number;
  lorebooks: number;
  backgrounds: number;
  personas: number;
}

export interface STBulkImportResult {
  success: boolean;
  error?: string;
  imported: STBulkImportedCounts;
  errors: string[];
}

export interface STBulkImportProgress {
  category: string;
  item: string;
  current: number;
  total: number;
  imported: STBulkImportedCounts;
}

export type STBulkImportPhase = "input" | "scanning" | "preview" | "importing" | "done";
export type STBulkCategoryKey = keyof STBulkImportedCounts;
export type STBulkSelectionState = Record<STBulkCategoryKey, string[]>;
export type STBulkTagImportMode = "all" | "none" | "existing";

export const ST_BULK_TAG_IMPORT_OPTIONS: Array<{
  value: STBulkTagImportMode;
  label: string;
  description: string;
}> = [
  { value: "all", label: "All tags", description: "Keep source tags." },
  { value: "none", label: "No tags", description: "Skip source tags." },
  { value: "existing", label: "Existing only", description: "Keep tags already in De-Koi." },
];

export function createEmptySTBulkSelection(): STBulkSelectionState {
  return {
    characters: [],
    chats: [],
    groupChats: [],
    presets: [],
    lorebooks: [],
    backgrounds: [],
    personas: [],
  };
}

export function buildInitialSTBulkSelection(scan: STBulkScanResult): STBulkSelectionState {
  return {
    characters: scan.characters.map((item) => item.id),
    chats: scan.chats.map((item) => item.id),
    groupChats: scan.groupChats.map((item) => item.id),
    presets: scan.presets.filter((item) => !item.isBuiltin).map((item) => item.id),
    lorebooks: scan.lorebooks.map((item) => item.id),
    backgrounds: scan.backgrounds.map((item) => item.id),
    personas: scan.personas.map((item) => item.id),
  };
}

export function hasSTBulkImported(imported: STBulkImportedCounts, category: STBulkCategoryKey): boolean {
  return Number(imported[category] ?? 0) > 0;
}

export function formatSTBulkModifiedAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
