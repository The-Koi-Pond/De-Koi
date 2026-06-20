export const LOREBOOK_WRITE_TOOL_NAME = "save_lorebook_entry";

export interface AgentLorebookWriterEditorState {
  enabledTools: string[];
  lorebookWriteEnabled: boolean;
  writableLorebookId: string;
}

export interface AgentLorebookWriterSaveState {
  enabledTools: string[];
  lorebookWriterEnabled: boolean;
  writableLorebookId: string;
  writerSettings: Record<string, unknown>;
}

function readBooleanSetting(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function readStringSetting(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringListSetting(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => readStringSetting(entry)).filter((entry) => entry.length > 0);
}

function uniqueToolNames(value: string[]): string[] {
  return Array.from(new Set(value.map((tool) => tool.trim()).filter((tool) => tool.length > 0)));
}

function readEnabledToolsSetting(settings: Record<string, unknown>, fallback: string[]): string[] {
  if (!Array.isArray(settings.enabledTools)) return uniqueToolNames(fallback);
  return uniqueToolNames(readStringListSetting(settings.enabledTools));
}

function readWriterTargetLorebookIdSetting(settings: Record<string, unknown>): string {
  const directId = readStringSetting(settings.writableLorebookId) || readStringSetting(settings.targetLorebookId);
  if (directId) return directId;
  return readStringListSetting(settings.writableLorebookIds)[0] ?? "";
}

export function normalizeAgentLorebookWriterEditorState(
  settings: Record<string, unknown>,
  fallbackEnabledTools: string[],
): AgentLorebookWriterEditorState {
  const enabledTools = readEnabledToolsSetting(settings, fallbackEnabledTools);
  return {
    enabledTools: enabledTools.filter((tool) => tool !== LOREBOOK_WRITE_TOOL_NAME),
    lorebookWriteEnabled:
      readBooleanSetting(settings.lorebookWriteEnabled, false) || enabledTools.includes(LOREBOOK_WRITE_TOOL_NAME),
    writableLorebookId: readWriterTargetLorebookIdSetting(settings),
  };
}

export function buildAgentLorebookWriterSaveState(args: {
  enabledTools: string[];
  isEditingCustomAgent: boolean;
  lorebookWriteEnabled: boolean;
  writableLorebookId: string;
}): AgentLorebookWriterSaveState {
  const baseEnabledTools = uniqueToolNames(args.enabledTools).filter((tool) => tool !== LOREBOOK_WRITE_TOOL_NAME);
  const writableLorebookId = args.writableLorebookId.trim();
  const lorebookWriterEnabled = args.isEditingCustomAgent && args.lorebookWriteEnabled;
  if (!lorebookWriterEnabled) {
    return {
      enabledTools: baseEnabledTools,
      lorebookWriterEnabled: false,
      writableLorebookId,
      writerSettings: {},
    };
  }

  return {
    enabledTools: [...baseEnabledTools, LOREBOOK_WRITE_TOOL_NAME],
    lorebookWriterEnabled: true,
    writableLorebookId,
    writerSettings: writableLorebookId
      ? {
          lorebookWriteEnabled: true,
          writableLorebookId,
          writableLorebookIds: [writableLorebookId],
        }
      : {},
  };
}
