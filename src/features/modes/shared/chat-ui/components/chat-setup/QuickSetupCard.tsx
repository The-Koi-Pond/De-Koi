import { useId, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Wand2, X } from "lucide-react";
import type { ChatPreset } from "../../../../../../engine/contracts/types/chat-preset";
import { useUIStore } from "../../../../../../shared/stores/ui.store";
import { useChatPresets } from "../../../../../catalog/chat-presets/index";
import { SetupCharacterChips, SetupCharacterList } from "./SetupCharacterList";
import { SetupPersonaPicker } from "./SetupPersonaPicker";
import { flagIsSet, type SetupChatFields } from "./setup-chat";
import {
  SETUP_FIELD_LABEL_CLASS,
  SETUP_ICON_BUTTON_CLASS,
  SETUP_PRIMARY_BUTTON_CLASS,
  SETUP_QUIET_BUTTON_CLASS,
  SETUP_SECTION_HEADING_CLASS,
  SETUP_SELECT_CLASS,
} from "./setup-styles";
import type { SetupCharacters } from "./use-setup-characters";

function isDefaultPreset(preset: ChatPreset): boolean {
  return flagIsSet(preset.isDefault, preset.default);
}

/** This chat's last applied preset, else the user's starred one, else the default. */
function initialPresetId(presets: readonly ChatPreset[], appliedId: unknown): string | null {
  const applied = presets.find((preset) => preset.id === appliedId);
  const starred = presets.find((preset) => flagIsSet(preset.isActive, preset.active) && !isDefaultPreset(preset));
  return (applied ?? starred ?? presets.find(isDefaultPreset))?.id ?? null;
}

/**
 * Quick setup: one card that applies a Roleplay chat-settings preset to the chat, with the persona and characters
 * picked on the same page. The apply itself and which result counts are the wizard's (see `RoleplaySetup`).
 */
export function QuickSetupCard({
  titleId,
  fields,
  personaId,
  characters,
  applying,
  onPickPersona,
  onApply,
  onBack,
  onClose,
  onOpenCharacters,
}: {
  titleId: string;
  fields: SetupChatFields;
  personaId: string | null;
  characters: SetupCharacters;
  /** An apply is still running, even one setup has stopped waiting for. */
  applying: boolean;
  onPickPersona: (personaId: string | null) => void;
  onApply: (presetId: string) => void;
  onBack: () => void;
  onClose: () => void;
  onOpenCharacters: () => void;
}) {
  const presetSelectId = useId();
  const personaHeadingId = useId();
  const charactersHeadingId = useId();
  const presetsQuery = useChatPresets("roleplay");
  const presets = useMemo(() => presetsQuery.data ?? [], [presetsQuery.data]);
  const [pickedPresetId, setPickedPresetId] = useState<string | null>(null);
  const presetId = pickedPresetId ?? initialPresetId(presets, fields.metadata.appliedChatPresetId);
  const loading = !presetsQuery.data;
  const count = characters.selectedIds.length;

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-3">
        <button type="button" aria-label="Back" onClick={onBack} className={SETUP_ICON_BUTTON_CLASS}>
          <ArrowLeft size="1rem" aria-hidden="true" />
        </button>
        <Wand2 size="1rem" aria-hidden="true" className="shrink-0 text-[var(--primary)]" />
        <h2 id={titleId} className="de-koi-display-title min-w-0 flex-1 truncate text-base font-bold">
          Quick setup
        </h2>
        <button type="button" aria-label="Close" onClick={onClose} className={SETUP_ICON_BUTTON_CLASS}>
          <X size="1rem" aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">
        <p className="text-xs text-[var(--muted-foreground)]">
          Pick a preset, your persona, and any characters to instantly configure this roleplay.
        </p>

        <div>
          <label htmlFor={presetSelectId} className={SETUP_FIELD_LABEL_CLASS}>
            Chat preset
          </label>
          <select
            id={presetSelectId}
            value={loading ? "" : (presetId ?? "")}
            disabled={loading}
            onChange={(event) => setPickedPresetId(event.target.value || null)}
            className={SETUP_SELECT_CLASS}
          >
            {loading ? (
              <option value="">Loading…</option>
            ) : (
              <>
                {!presetId && <option value="">Choose a preset</option>}
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {isDefaultPreset(preset) ? "Default" : preset.name}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>

        <section className="flex flex-col gap-2">
          <h3 id={personaHeadingId} className={SETUP_SECTION_HEADING_CLASS}>
            Persona
          </h3>
          <SetupPersonaPicker personaId={personaId} labelledBy={personaHeadingId} onPick={onPickPersona} />
        </section>

        <section aria-labelledby={charactersHeadingId} className="flex flex-col gap-2">
          <h3 id={charactersHeadingId} className={SETUP_SECTION_HEADING_CLASS}>
            {count > 0 ? `Characters · ${count}` : "Characters"}
          </h3>
          <SetupCharacterChips characters={characters.selected} onRemove={characters.remove} />
          <SetupCharacterList
            enabled
            selectedIds={characters.selectedIds}
            noCharactersText="No characters yet. Create or import one before applying setup."
            allAddedText="All characters added."
            onAdd={(character) => void characters.add(character)}
            onCreated={(id, name) => void characters.addNamed(id, name)}
            onImport={() => useUIStore.getState().openModal("import-character")}
            onOpenCharacters={onOpenCharacters}
          />
        </section>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
        <button type="button" onClick={onBack} className={SETUP_QUIET_BUTTON_CLASS}>
          Back
        </button>
        <button
          type="button"
          disabled={!presetId || applying}
          onClick={() => presetId && onApply(presetId)}
          className={SETUP_PRIMARY_BUTTON_CLASS}
        >
          {applying && <Loader2 size="0.85rem" aria-hidden="true" className="animate-spin" />}
          {applying ? "Applying…" : "Apply & start"}
        </button>
      </footer>
    </>
  );
}
