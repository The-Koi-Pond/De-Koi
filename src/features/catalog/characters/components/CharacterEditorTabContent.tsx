import type {
  CharacterBehavioralInterpretation,
  CharacterData,
  CharacterMemoryPersistence,
} from "../../../../engine/contracts/types/character";
import type { ImageGenerationConnectionOption } from "../../../../shared/types/image-generation";
import { HelpTooltip } from "../../../../shared/components/ui/HelpTooltip";
import { CharacterAdvancedTab } from "./CharacterAdvancedTab";
import { CharacterBehaviorTab } from "./CharacterBehaviorTab";
import { CharacterColorsTab } from "./CharacterColorsTab";
import { CharacterDescriptionTab } from "./CharacterDescriptionTab";
import { CharacterDialogueTab } from "./CharacterDialogueTab";
import { CharacterGalleryTab } from "./CharacterGalleryTab";
import { CharacterLorebookTab } from "./CharacterLorebookTab";
import { CharacterMetadataTab } from "./CharacterMetadataTab";
import { CharacterMemoriesTab } from "./CharacterMemoriesTab";
import { CharacterSpritesTab } from "./CharacterSpritesTab";
import { CharacterStatsTab } from "./CharacterStatsTab";
import { CharacterTextareaTab } from "./CharacterTextareaTab";
import type { CharacterEditorTabId } from "./CharacterEditorTabRail";
import type { SaveEnhancedOpeningAlternateInput } from "../lib/enhanced-opening-generation";

type CharacterUpdateField = <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => void;

type CharacterEditorTabContentProps = {
  activeTab: CharacterEditorTabId;
  characterId: string | null;
  formData: CharacterData;
  characterComment: string;
  memoryPersistence: CharacterMemoryPersistence;
  behavioralInterpretation?: CharacterBehavioralInterpretation;
  onBehavioralInterpretationChange: (value: CharacterBehavioralInterpretation) => void;
  onMemoryPersistenceChange: (value: CharacterMemoryPersistence) => void;
  onSaveEnhancedOpeningAlternate: (input: SaveEnhancedOpeningAlternateInput) => Promise<void>;
  updateField: CharacterUpdateField;
  updateExtension: (key: string, value: unknown) => void;
  newTag: string;
  setNewTag: (tag: string) => void;
  avatarPreview: string | null;
  imageConnections: ImageGenerationConnectionOption[];
};

export function CharacterEditorTabContent({
  activeTab,
  characterId,
  formData,
  characterComment,
  memoryPersistence,
  behavioralInterpretation,
  onBehavioralInterpretationChange,
  onMemoryPersistenceChange,
  onSaveEnhancedOpeningAlternate,
  updateField,
  updateExtension,
  newTag,
  setNewTag,
  avatarPreview,
  imageConnections,
}: CharacterEditorTabContentProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6 @max-5xl:p-4">
      <div className="mx-auto max-w-2xl">
        {activeTab === "metadata" && (
          <CharacterMetadataTab
            characterId={characterId}
            formData={formData}
            characterComment={characterComment}
            updateField={updateField}
            updateExtension={updateExtension}
            newTag={newTag}
            setNewTag={setNewTag}
            avatarPreview={avatarPreview}
            imageConnections={imageConnections}
          />
        )}
        {activeTab === "description" && (
          <CharacterDescriptionTab formData={formData} characterComment={characterComment} updateField={updateField} />
        )}
        {activeTab === "personality" && (
          <CharacterTextareaTab
            title="Personality"
            subtitle="A concise summary of the character's personality traits, temperament, and behavioral patterns."
            value={formData.personality}
            onChange={(v) => updateField("personality", v)}
            placeholder="Energetic, curious, and fiercely loyal. Speaks in short bursts. Has a habit of…"
            rows={8}
            generationField="personality"
            generationData={formData}
            characterComment={characterComment}
          />
        )}
        {activeTab === "backstory" && (
          <CharacterTextareaTab
            title="Backstory"
            subtitle="The character's history, origin story, and formative life events."
            value={(formData.extensions.backstory as string) ?? ""}
            onChange={(v) => updateExtension("backstory", v)}
            placeholder="Born in a small village on the outskirts of the empire…"
            rows={12}
            generationField="backstory"
            generationData={formData}
            characterComment={characterComment}
          />
        )}
        {activeTab === "appearance" && (
          <div className="space-y-6">
            <CharacterTextareaTab
              title="Appearance"
              subtitle="Detailed physical description — height, build, hair, eyes, clothing, distinguishing features."
              value={(formData.extensions.appearance as string) ?? ""}
              onChange={(v) => updateExtension("appearance", v)}
              placeholder="Tall and willowy with silver-streaked dark hair. Wears a battered leather coat over…"
              rows={8}
              generationField="appearance"
              generationData={formData}
              characterComment={characterComment}
            />
            <label className="block space-y-1.5">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
                Selfie look tags{" "}
                <HelpTooltip text="Comma-separated image tags added to every selfie of this character, in any chat. List what makes them recognizable at a glance: face, mask, hair, markings. Keeps selfies on model instead of guessing from the description." />
              </span>
              <input
                type="text"
                value={(formData.extensions.selfieLookTags as string) ?? ""}
                onChange={(event) => updateExtension("selfieLookTags", event.target.value)}
                placeholder="white mask, wide grin, curly black hair"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-4 py-2.5 text-sm outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
                Selfie outfit tags{" "}
                <HelpTooltip text="Comma-separated image tags for what this character usually wears. Added to every selfie unless the request changes their clothes (shirtless, in pajamas, in a towel, nude), so a costume stays consistent without blocking other looks." />
              </span>
              <input
                type="text"
                value={(formData.extensions.selfieOutfitTags as string) ?? ""}
                onChange={(event) => updateExtension("selfieOutfitTags", event.target.value)}
                placeholder="green jester hat with bells, black cape, striped sleeves"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-4 py-2.5 text-sm outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
              />
            </label>
          </div>
        )}
        {activeTab === "scenario" && (
          <CharacterTextareaTab
            title="Scenario"
            subtitle="The default setting or situation where interactions take place."
            value={formData.scenario}
            onChange={(v) => updateField("scenario", v)}
            placeholder="A bustling port city during a trade festival. The streets are alive with merchants and performers…"
            rows={8}
            generationField="scenario"
            generationData={formData}
            characterComment={characterComment}
          />
        )}
        {activeTab === "dialogue" && (
          <CharacterDialogueTab
            formData={formData}
            characterComment={characterComment}
            updateField={updateField}
            onSaveEnhancedOpeningAlternate={onSaveEnhancedOpeningAlternate}
          />
        )}
        {activeTab === "advanced" && (
          <CharacterAdvancedTab
            formData={formData}
            characterComment={characterComment}
            updateField={updateField}
            updateExtension={updateExtension}
          />
        )}
        {activeTab === "sprites" && characterId && (
          <CharacterSpritesTab
            characterId={characterId}
            defaultAppearance={(formData.extensions.appearance as string) ?? formData.description}
            defaultAvatarUrl={avatarPreview}
            imageConnections={imageConnections}
          />
        )}
        {activeTab === "gallery" && characterId && (
          <CharacterGalleryTab characterId={characterId} characterName={formData.name} />
        )}
        {activeTab === "colors" && (
          <CharacterColorsTab
            formData={formData}
            updateExtension={updateExtension}
            avatarUrl={avatarPreview}
            characterId={characterId ?? null}
          />
        )}
        {activeTab === "stats" && <CharacterStatsTab formData={formData} updateExtension={updateExtension} />}
        {activeTab === "memories" && characterId && (
          <CharacterMemoriesTab
            characterId={characterId}
            characterName={formData.name}
            memoryPersistence={memoryPersistence}
            onMemoryPersistenceChange={onMemoryPersistenceChange}
          />
        )}
        {activeTab === "behavior" && (
          <CharacterBehaviorTab
            data={formData}
            profile={behavioralInterpretation}
            onChange={onBehavioralInterpretationChange}
          />
        )}
        {activeTab === "lorebook" && <CharacterLorebookTab characterId={characterId} formData={formData} />}
      </div>
    </div>
  );
}
