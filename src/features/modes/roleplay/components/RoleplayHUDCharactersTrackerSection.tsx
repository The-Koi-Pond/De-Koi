import { useCallback, useRef, useState } from "react";
import { ImagePlus, Plus, Sparkles, Users, X } from "lucide-react";
import type { PresentCharacter } from "../../../../engine/contracts/types/game-state";
import { cn } from "../../../../shared/lib/utils";
import { AvatarImage } from "../../../../shared/components/ui/AvatarImage";
import { useTrackerCharacterAvatarActions } from "../../../runtime/world-state/index";
import {
  appendTrackerListItem,
  createManualPresentCharacter,
  removeTrackerListItem,
  replaceTrackerListItem,
} from "../../../runtime/world-state/index";
import { TRACKER_SECTION_AGENT_TYPES } from "../../../runtime/world-state/index";
import { InlineEdit } from "./RoleplayHUDInlineEdit";
import { LabeledEdit, TrackerSectionRefresh } from "./RoleplayHUDPanelPrimitives";
import { StatBarEditable } from "./RoleplayHUDStatControls";
import {
  bodyClass,
  emptyClass,
  headerClass,
  sectionPadding,
  type TrackerRetryControls,
  type TrackerSectionLayout,
} from "./RoleplayHUDTrackerSectionLayout";

export function CharactersTrackerSection({
  characters,
  onUpdate,
  chatId,
  layout = "panel",
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: {
  characters: PresentCharacter[];
  onUpdate: (chars: PresentCharacter[]) => void;
  chatId?: string;
  layout?: TrackerSectionLayout;
} & TrackerRetryControls) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadIdx, setUploadIdx] = useState<number | null>(null);
  const {
    autoGenerateCharacterAvatars,
    canToggleAutoGenerateCharacterAvatars,
    isUpdatingAutoGenerateCharacterAvatars,
    toggleAutoGenerateCharacterAvatars,
    uploadCharacterAvatar,
  } = useTrackerCharacterAvatarActions({
    chatId,
    characters,
    onUpdateCharacters: onUpdate,
    agentConfigLookupEnabled: layout === "panel",
  });

  const handleAvatarUpload = useCallback(
    (idx: number, file: File) => void uploadCharacterAvatar(idx, file),
    [uploadCharacterAvatar],
  );

  const addCharacter = () => {
    onUpdate(appendTrackerListItem(characters, createManualPresentCharacter({ emoji: "👤" })));
  };
  const removeCharacter = (idx: number) => {
    onUpdate(removeTrackerListItem(characters, idx));
  };
  const updateCharacter = (idx: number, updated: PresentCharacter) => {
    onUpdate(replaceTrackerListItem(characters, idx, updated));
  };

  const renderCharacterAvatar = (char: PresentCharacter, idx: number) => {
    if (layout === "combined") {
      return (
        <InlineEdit
          value={char.emoji || "👤"}
          onSave={(value) => updateCharacter(idx, { ...char, emoji: value })}
          className="w-8 text-center text-sm!"
        />
      );
    }

    if (char.avatarPath) {
      return (
        <button
          type="button"
          onClick={() => {
            setUploadIdx(idx);
            fileInputRef.current?.click();
          }}
          className="shrink-0 rounded-full overflow-hidden ring-1 ring-purple-400/40 hover:ring-purple-400/80 transition-all"
          title="Change avatar"
        >
          <AvatarImage src={char.avatarPath} alt={char.name} className="h-8 w-8" />
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => {
          setUploadIdx(idx);
          fileInputRef.current?.click();
        }}
        className="shrink-0 w-8 h-8 rounded-full bg-[var(--muted)]/30 flex items-center justify-center text-[var(--muted-foreground)]/50 hover:text-purple-400 hover:bg-[var(--muted)]/50 transition-all ring-1 ring-[var(--border)]"
        title="Upload avatar"
      >
        <ImagePlus size="0.75rem" />
      </button>
    );
  };

  return (
    <div className={sectionPadding(layout)}>
      <div className={headerClass(layout)}>
        <span
          className={cn(
            "text-[0.625rem] font-semibold uppercase tracking-wider flex items-center gap-1",
            layout === "combined" ? "text-purple-300/70" : "text-[var(--muted-foreground)]",
          )}
        >
          <Users size={layout === "combined" ? "0.5625rem" : "0.625rem"} />
          {layout === "combined" ? `Characters (${characters.length})` : "Present Characters"}
        </span>
        <span className={cn("flex items-center", layout === "combined" ? "gap-1" : "gap-2")}>
          <TrackerSectionRefresh
            agentType={TRACKER_SECTION_AGENT_TYPES.characters}
            onRerunSingleTracker={onRerunSingleTracker}
            busy={isTrackerRetryBusy}
            title="Re-run character tracker only"
          />
          {layout === "panel" && canToggleAutoGenerateCharacterAvatars && (
            <button
              type="button"
              onClick={toggleAutoGenerateCharacterAvatars}
              disabled={isUpdatingAutoGenerateCharacterAvatars}
              className={cn(
                "flex items-center gap-1 text-[0.5625rem] transition-colors",
                autoGenerateCharacterAvatars
                  ? "text-purple-400"
                  : "text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)]",
              )}
              title={autoGenerateCharacterAvatars ? "Auto-generate avatars: ON" : "Auto-generate avatars: OFF"}
            >
              <Sparkles size="0.5625rem" />
              <span className="hidden sm:inline">Auto</span>
            </button>
          )}
          <button
            type="button"
            onClick={addCharacter}
            className="flex items-center gap-0.5 text-[0.625rem] text-purple-400 hover:text-purple-300 transition-colors"
          >
            <Plus size="0.625rem" /> Add
          </button>
        </span>
      </div>
      <div className={bodyClass(layout, "space-y-2")}>
        {characters.length === 0 && <div className={emptyClass(layout)}>No characters in scene</div>}
        {characters.map((char, idx) => (
          <div key={char.characterId ?? idx} className="rounded-lg bg-[var(--muted)]/20 p-2 space-y-1">
            <div className="flex items-center gap-1.5">
              {renderCharacterAvatar(char, idx)}
              <InlineEdit
                value={char.name}
                onSave={(value) => updateCharacter(idx, { ...char, name: value })}
                className="flex-1 font-medium!"
                placeholder="Name"
              />
              <button
                type="button"
                onClick={() => removeCharacter(idx)}
                className="text-[var(--muted-foreground)]/40 hover:text-red-500 transition-colors shrink-0"
                title="Remove character"
              >
                <X size="0.625rem" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 pl-1">
              <LabeledEdit
                label="Mood"
                value={char.mood}
                onSave={(value) => updateCharacter(idx, { ...char, mood: value })}
              />
              <LabeledEdit
                label="Look"
                value={char.appearance ?? ""}
                onSave={(value) => updateCharacter(idx, { ...char, appearance: value || null })}
              />
              <LabeledEdit
                label="Outfit"
                value={char.outfit ?? ""}
                onSave={(value) => updateCharacter(idx, { ...char, outfit: value || null })}
              />
              <LabeledEdit
                label="Thinks"
                value={char.thoughts ?? ""}
                onSave={(value) => updateCharacter(idx, { ...char, thoughts: value || null })}
              />
            </div>
            {char.stats?.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-[var(--border)]">
                {char.stats.map((stat, statIndex) => (
                  <StatBarEditable
                    key={stat.name}
                    stat={stat}
                    onUpdateValue={(value) => {
                      updateCharacter(idx, {
                        ...char,
                        stats: replaceTrackerListItem(char.stats ?? [], statIndex, { ...stat, value }),
                      });
                    }}
                    onUpdateMax={(value) => {
                      updateCharacter(idx, {
                        ...char,
                        stats: replaceTrackerListItem(char.stats ?? [], statIndex, { ...stat, max: value }),
                      });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {layout === "panel" && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && uploadIdx !== null) handleAvatarUpload(uploadIdx, file);
            event.target.value = "";
          }}
        />
      )}
    </div>
  );
}
