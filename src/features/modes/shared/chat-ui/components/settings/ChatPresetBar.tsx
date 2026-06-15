import { Download, FilePlus2, Pencil, Save, Star, Trash2, Upload } from "lucide-react";
import type { ChangeEvent, KeyboardEvent, RefObject } from "react";

import { HelpTooltip } from "../../../../../../shared/components/ui/HelpTooltip";
import { cn } from "../../../../../../shared/lib/utils";
import type { ChatPreset } from "../../../../../../engine/contracts/types/chat-preset";

export function ChatPresetBar({
  fileInputRef,
  isConversation,
  presetList,
  selectedChatPreset,
  selectedChatPresetIsActive,
  selectedChatPresetIsDefault,
  renamingPreset,
  renamePresetVal,
  defaultTogglePending,
  onImportFile,
  onRenamePresetValChange,
  onCommitRenamePreset,
  onCancelRenamePreset,
  onSelectPreset,
  onToggleDefaultPreset,
  onSaveIntoPreset,
  onStartRenamePreset,
  onSaveAsPreset,
  onImportClick,
  onExportPreset,
  onDeletePreset,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  isConversation: boolean;
  presetList: ChatPreset[];
  selectedChatPreset: ChatPreset | null;
  selectedChatPresetIsActive: boolean;
  selectedChatPresetIsDefault: boolean;
  renamingPreset: boolean;
  renamePresetVal: string;
  defaultTogglePending: boolean;
  onImportFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onRenamePresetValChange: (value: string) => void;
  onCommitRenamePreset: () => void;
  onCancelRenamePreset: () => void;
  onSelectPreset: (id: string) => void;
  onToggleDefaultPreset: () => void;
  onSaveIntoPreset: () => void;
  onStartRenamePreset: () => void;
  onSaveAsPreset: () => void;
  onImportClick: () => void;
  onExportPreset: () => void;
  onDeletePreset: () => void;
}) {
  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") onCommitRenamePreset();
    else if (event.key === "Escape") onCancelRenamePreset();
  };

  return (
    <div className="flex flex-col gap-2 border-b border-[var(--border)] px-4 py-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={onImportFile}
      />
      <div className="flex items-center gap-2">
        {renamingPreset ? (
          <input
            value={renamePresetVal}
            onChange={(event) => onRenamePresetValChange(event.target.value)}
            onBlur={onCommitRenamePreset}
            onKeyDown={handleRenameKeyDown}
            autoFocus
            maxLength={120}
            className="flex-1 min-w-0 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-[var(--primary)]/40"
          />
        ) : (
          <select
            value={selectedChatPreset?.id ?? ""}
            onChange={(event) => onSelectPreset(event.target.value)}
            title="Apply a chat-settings preset to this chat"
            className="flex-1 min-w-0 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
          >
            {presetList.length === 0 && <option value="">Loading…</option>}
            {presetList.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {selectedLabel(preset)}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={onToggleDefaultPreset}
          disabled={!selectedChatPreset || selectedChatPresetIsActive || defaultTogglePending}
          title={
            !selectedChatPreset
              ? "Select a preset to mark it as default"
              : selectedChatPresetIsActive
                ? "This preset is the default for new chats in this mode"
                : "Mark this preset as default for new chats in this mode"
          }
          aria-pressed={selectedChatPresetIsActive}
          aria-label={selectedChatPresetIsActive ? "Default preset" : "Mark as default preset"}
          className={cn(
            "shrink-0 flex items-center justify-center rounded-md p-1.5 transition-colors disabled:cursor-not-allowed",
            selectedChatPresetIsActive
              ? "text-yellow-400 disabled:opacity-100"
              : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-yellow-400 disabled:opacity-40",
          )}
        >
          <Star
            size="0.875rem"
            fill={selectedChatPresetIsActive ? "currentColor" : "none"}
            strokeWidth={selectedChatPresetIsActive ? 1.5 : 2}
          />
        </button>
        <HelpTooltip
          side="left"
          text={
            isConversation
              ? "Presets bundle this chat's connection, tools, translation, memory recall, advanced parameters, and other settings. Prompt presets are not applied in conversation mode. Characters, persona, lorebooks, sprites, summary, tags, and scene prompt stay tied to the chat. Star a preset to use it as the default for new chats in this mode."
              : "Presets bundle this chat's connection, prompt preset, agents, tools, translation, memory recall, advanced parameters, and other settings. They never touch your characters, persona, lorebooks, sprites, summary, tags, or scene prompt — those stay tied to the chat. Star a preset to use it as the default for new chats in this mode."
          }
        />
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onSaveIntoPreset}
          disabled={!selectedChatPreset || selectedChatPresetIsDefault}
          title={
            selectedChatPresetIsDefault ? "Cannot save into the Default preset" : "Save current chat settings into this preset"
          }
          className="flex-1 flex items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save size="0.875rem" />
        </button>
        <button
          onClick={onStartRenamePreset}
          disabled={!selectedChatPreset || selectedChatPresetIsDefault}
          title={selectedChatPresetIsDefault ? "Cannot rename the Default preset" : "Rename preset"}
          className="flex-1 flex items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Pencil size="0.875rem" />
        </button>
        <button
          onClick={onSaveAsPreset}
          disabled={!selectedChatPreset}
          title="Save current chat settings as a new preset"
          className="flex-1 flex items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FilePlus2 size="0.875rem" />
        </button>
        <span className="mx-1 h-4 w-px shrink-0 bg-[var(--border)]" aria-hidden />
        <button
          onClick={onImportClick}
          title="Import preset (.json)"
          className="flex-1 flex items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <Upload size="0.875rem" />
        </button>
        <button
          onClick={onExportPreset}
          disabled={!selectedChatPreset}
          title="Export preset (.json)"
          className="flex-1 flex items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size="0.875rem" />
        </button>
        <button
          onClick={onDeletePreset}
          disabled={!selectedChatPreset || selectedChatPresetIsDefault}
          title={selectedChatPresetIsDefault ? "Cannot delete the Default preset" : "Delete preset"}
          className="flex-1 flex items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 size="0.875rem" />
        </button>
      </div>
    </div>
  );
}

function selectedLabel(preset: ChatPreset): string {
  const isDefault =
    preset.isDefault === true ||
    preset.default === true ||
    String(preset.isDefault ?? "") === "true" ||
    String(preset.default ?? "") === "true";
  return isDefault ? "Default" : preset.name;
}
