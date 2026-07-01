import { useRef, useState } from "react";
import { Loader2, Maximize2, Tag, Wand2, X } from "lucide-react";

import type { CharacterData, CharacterPublicProfile } from "../../../../engine/contracts/types/character";
import { AvatarCropWidget } from "../../../../shared/components/ui/AvatarCropWidget";
import { ExpandedTextarea } from "../../../../shared/components/ui/ExpandedTextarea";
import { HelpTooltip } from "../../../../shared/components/ui/HelpTooltip";
import { imageGenerationApi } from "../../../../shared/api/image-generation-api";
import { llmApi } from "../../../../shared/api/llm-api";
import { storageApi } from "../../../../shared/api/storage-api";
import type { AvatarCrop } from "../../../../shared/lib/utils";
import { useUIStore } from "../../../../shared/stores/ui.store";
import {
  isDefaultImageGenerationConnection,
  type ImageGenerationConnectionOption,
} from "../../../../shared/types/image-generation";
import { CharacterEditorSectionHeader as SectionHeader } from "./CharacterEditorSectionHeader";
import { CharacterFieldGenerationButton } from "./CharacterFieldGenerationButton";
import { CharacterVersionHistoryPanel } from "./CharacterVersionHistoryPanel";
import {
  buildCharacterPublicProfileBannerPrompt,
  generateCharacterPublicProfileField,
  type CharacterPublicProfileSuggestionField,
} from "../lib/character-public-profile";

function readPublicProfile(value: unknown): CharacterPublicProfile {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as CharacterPublicProfile) : {};
}

type ConnectionRecord = {
  id?: unknown;
  provider?: unknown;
  isDefault?: unknown;
  default?: unknown;
};

const publicProfileFieldLabels: Record<CharacterPublicProfileSuggestionField, string> = {
  displayName: "display name",
  handle: "handle",
  bio: "bio",
};

function boolish(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

async function resolveDefaultTextConnectionId(): Promise<string> {
  const connections = await storageApi.list<ConnectionRecord>("connections");
  const textConnections = connections.filter((connection) => connection.provider !== "image_generation");
  const selected =
    textConnections.find((connection) => boolish(connection.isDefault) || boolish(connection.default)) ??
    textConnections[0];
  const connectionId = typeof selected?.id === "string" ? selected.id.trim() : "";
  if (!connectionId) throw new Error("No text connection configured");
  return connectionId;
}

export function CharacterMetadataTab({
  characterId,
  formData,
  characterComment,
  updateField,
  updateExtension,
  newTag,
  setNewTag,
  addTag,
  removeTag,
  removeAllTags,
  avatarPreview,
  imageConnections,
}: {
  characterId: string | null;
  formData: CharacterData;
  characterComment: string;
  updateField: <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => void;
  updateExtension: (key: string, value: unknown) => void;
  newTag: string;
  setNewTag: (value: string) => void;
  addTag: () => void;
  removeTag: (tag: string) => void;
  removeAllTags: () => void;
  avatarPreview: string | null;
  imageConnections: ImageGenerationConnectionOption[];
}) {
  const [expandedCreatorNotes, setExpandedCreatorNotes] = useState(false);
  const [publicProfileGeneratingFields, setPublicProfileGeneratingFields] = useState<
    Set<CharacterPublicProfileSuggestionField>
  >(() => new Set());
  const [publicProfileGenerationError, setPublicProfileGenerationError] = useState("");
  const [publicProfileBannerGenerating, setPublicProfileBannerGenerating] = useState(false);
  const publicProfileAbortRefs = useRef(new Map<CharacterPublicProfileSuggestionField, AbortController>());
  const creatorNotesId = "character-creator-notes";
  // Read the saved source-rectangle crop and write the same current shape on edit.
  const savedCrop = (formData.extensions.avatarCrop as AvatarCrop | undefined) ?? null;
  const imageBackgroundWidth = useUIStore((state) => state.imageBackgroundWidth);
  const imageBackgroundHeight = useUIStore((state) => state.imageBackgroundHeight);
  const talkativeness = typeof formData.extensions.talkativeness === "number" ? formData.extensions.talkativeness : 0.5;
  const publicProfile = readPublicProfile(formData.extensions.publicProfile);
  const publicProfileRef = useRef(publicProfile);
  publicProfileRef.current = publicProfile;
  const updatePublicProfile = (patch: CharacterPublicProfile) => {
    const next = { ...publicProfileRef.current, ...patch };
    publicProfileRef.current = next;
    updateExtension("publicProfile", next);
  };
  const isPublicProfileGenerating = (field: CharacterPublicProfileSuggestionField) =>
    publicProfileGeneratingFields.has(field);
  const publicProfileGeneratingLabels = Array.from(publicProfileGeneratingFields).map(
    (field) => publicProfileFieldLabels[field],
  );
  const applyGeneratedTags = (value: unknown) => {
    if (!Array.isArray(value)) return;
    const seen = new Set(formData.tags.map((tag) => tag.toLowerCase()));
    const merged = [...formData.tags];
    for (const item of value) {
      if (typeof item !== "string") continue;
      const tag = item.trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(tag);
    }
    updateField("tags", merged);
  };
  const defaultImageConnectionId =
    imageConnections.find(isDefaultImageGenerationConnection)?.id ?? imageConnections[0]?.id ?? null;
  const applyPublicProfileSuggestion = async (field: CharacterPublicProfileSuggestionField) => {
    if (publicProfileAbortRefs.current.has(field)) return;
    const abort = new AbortController();
    publicProfileAbortRefs.current.set(field, abort);
    setPublicProfileGeneratingFields((current) => new Set(current).add(field));
    setPublicProfileGenerationError("");

    try {
      const connectionId = await resolveDefaultTextConnectionId();
      const value = await generateCharacterPublicProfileField({
        field,
        data: formData,
        comment: characterComment,
        connectionId,
        llm: llmApi,
        signal: abort.signal,
      });
      updatePublicProfile({ [field]: value } as CharacterPublicProfile);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setPublicProfileGenerationError(err instanceof Error ? err.message : "Public profile generation failed");
      }
    } finally {
      if (publicProfileAbortRefs.current.get(field) === abort) {
        publicProfileAbortRefs.current.delete(field);
        setPublicProfileGeneratingFields((current) => {
          const next = new Set(current);
          next.delete(field);
          return next;
        });
      }
    }
  };
  const applyPublicProfileBannerImage = async () => {
    if (!defaultImageConnectionId || publicProfileBannerGenerating) return;
    setPublicProfileBannerGenerating(true);
    setPublicProfileGenerationError("");

    try {
      const result = await imageGenerationApi.generate<{ image?: string; base64?: string; mimeType?: string }>({
        connectionId: defaultImageConnectionId,
        prompt: buildCharacterPublicProfileBannerPrompt({ data: formData, comment: characterComment }),
        width: imageBackgroundWidth,
        height: imageBackgroundHeight,
      });
      const generatedImage =
        typeof result.image === "string" && result.image.trim()
          ? result.image.trim()
          : typeof result.base64 === "string" && result.base64.trim()
            ? `data:${result.mimeType || "image/png"};base64,${result.base64.trim()}`
            : "";
      if (!generatedImage) throw new Error("Image provider returned no banner image.");
      updatePublicProfile({ bannerImage: generatedImage });
    } catch (err) {
      setPublicProfileGenerationError(err instanceof Error ? err.message : "Banner image generation failed");
    } finally {
      setPublicProfileBannerGenerating(false);
    }
  };

  const profileWandButtonClass =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30 disabled:cursor-wait disabled:opacity-60";

  return (
    <div className="space-y-5">
      <SectionHeader title="Metadata" subtitle="Basic character info - name, creator, version, tags." />

      {avatarPreview && (
        <AvatarCropWidget
          src={avatarPreview}
          alt={formData.name}
          crop={savedCrop}
          onChange={(next) => updateExtension("avatarCrop", next)}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Name{" "}
            <HelpTooltip text="The character's display name. This is what appears in chat and is used as {{char}} in prompts." />
          </span>
          <input
            value={formData.name}
            onChange={(event) => updateField("name", event.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
          />
        </label>
        <label className="space-y-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Creator{" "}
            <HelpTooltip text="The person who made this character. Useful for giving credit when sharing characters." />
          </span>
          <input
            value={formData.creator}
            onChange={(event) => updateField("creator", event.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            placeholder="Your name"
          />
        </label>
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Version <HelpTooltip text="Version number for tracking changes to this character definition over time." />
          </span>
          <input
            value={formData.character_version}
            onChange={(event) => updateField("character_version", event.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            placeholder="1.0"
          />
          <CharacterVersionHistoryPanel
            characterId={characterId}
            currentData={formData}
            currentComment={characterComment}
            currentAvatarPath={avatarPreview}
          />
        </div>
        <label className="space-y-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Talkativeness{" "}
            <HelpTooltip text="How often this character speaks in group chats. 0% = rarely speaks unless addressed, 100% = responds to almost everything." />
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={talkativeness}
            onChange={(event) => updateExtension("talkativeness", parseFloat(event.target.value))}
            className="w-full accent-[var(--primary)]"
          />
          <span className="text-[0.625rem] text-[var(--muted-foreground)]">{Math.round(talkativeness * 100)}%</span>
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Tags{" "}
            <HelpTooltip text="Labels for organizing characters. Use tags like 'fantasy', 'sci-fi', 'OC' etc. to categorize and search." />
          </span>
          <div className="flex items-center gap-1">
            <CharacterFieldGenerationButton
              field="tags"
              data={formData}
              comment={characterComment}
              mode="direct"
              onApply={applyGeneratedTags}
            />
            {formData.tags.length > 0 && (
              <button
                type="button"
                onClick={removeAllTags}
                className="rounded-lg px-2 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
              >
                Remove All
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {formData.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-[var(--primary)]/10 px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--primary)]"
            >
              <Tag size="0.625rem" />
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="ml-0.5 rounded-full transition-colors hover:text-[var(--destructive)]"
              >
                <X size="0.625rem" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            value={newTag}
            onChange={(event) => setNewTag(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addTag()}
            placeholder="Add tag..."
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs outline-none focus:border-[var(--primary)]/40"
          />
          <button
            type="button"
            onClick={addTag}
            className="rounded-xl bg-[var(--primary)]/15 px-3 py-1.5 text-xs font-medium text-[var(--primary)] transition-all hover:bg-[var(--primary)]/25"
          >
            Add
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/35 p-4">
        <SectionHeader title="Public Profile" subtitle="Outward-facing identity used by quick inspect cards." />
        {(publicProfileGeneratingFields.size > 0 || publicProfileBannerGenerating) && (
          <div
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--primary)]/20 bg-[var(--primary)]/8 px-2.5 py-1.5 text-xs font-medium text-[var(--primary)]"
          >
            <Loader2 size="0.75rem" className="animate-spin" />
            {publicProfileGeneratingLabels.length > 0
              ? `Generating ${publicProfileGeneratingLabels.join(", ")}...`
              : "Generating banner image..."}
          </div>
        )}
        {publicProfileGenerationError && (
          <div
            role="alert"
            className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/8 px-2.5 py-1.5 text-xs font-medium text-[var(--destructive)]"
          >
            {publicProfileGenerationError}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
                Display Name{" "}
                <HelpTooltip text="Optional name for profile previews. Chat still uses the character name above." />
              </span>
              <button
                type="button"
                onClick={() => applyPublicProfileSuggestion("displayName")}
                disabled={isPublicProfileGenerating("displayName")}
                className={profileWandButtonClass}
                title="Generate display name"
                aria-label="Generate display name"
                aria-busy={isPublicProfileGenerating("displayName")}
              >
                {isPublicProfileGenerating("displayName") ? (
                  <Loader2 size="0.875rem" className="animate-spin" />
                ) : (
                  <Wand2 size="0.875rem" />
                )}
              </button>
            </div>
            <input
              value={publicProfile.displayName ?? ""}
              onChange={(event) => updatePublicProfile({ displayName: event.target.value })}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
              placeholder={formData.name}
            />
          </label>
          <label className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
                Handle <HelpTooltip text="Optional short username shown on profile previews." />
              </span>
              <button
                type="button"
                onClick={() => applyPublicProfileSuggestion("handle")}
                disabled={isPublicProfileGenerating("handle")}
                className={profileWandButtonClass}
                title="Generate handle"
                aria-label="Generate handle"
                aria-busy={isPublicProfileGenerating("handle")}
              >
                {isPublicProfileGenerating("handle") ? (
                  <Loader2 size="0.875rem" className="animate-spin" />
                ) : (
                  <Wand2 size="0.875rem" />
                )}
              </button>
            </div>
            <input
              value={publicProfile.handle ?? ""}
              onChange={(event) => updatePublicProfile({ handle: event.target.value })}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
              placeholder="@username"
            />
          </label>
        </div>
        <label className="space-y-1.5 block">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
              Bio <HelpTooltip text="Short public blurb for profile previews." />
            </span>
            <button
              type="button"
              onClick={() => applyPublicProfileSuggestion("bio")}
              disabled={isPublicProfileGenerating("bio")}
              className={profileWandButtonClass}
              title="Generate bio"
              aria-label="Generate bio"
              aria-busy={isPublicProfileGenerating("bio")}
            >
              {isPublicProfileGenerating("bio") ? (
                <Loader2 size="0.875rem" className="animate-spin" />
              ) : (
                <Wand2 size="0.875rem" />
              )}
            </button>
          </div>
          <textarea
            value={publicProfile.bio ?? ""}
            onChange={(event) => updatePublicProfile({ bio: event.target.value })}
            rows={3}
            className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-sm outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            placeholder="A short outward-facing intro..."
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
                Banner Image <HelpTooltip text="Optional image URL for profile previews." />
              </span>
              <button
                type="button"
                onClick={applyPublicProfileBannerImage}
                disabled={!defaultImageConnectionId || publicProfileBannerGenerating}
                className={profileWandButtonClass}
                title={defaultImageConnectionId ? "Generate banner image" : "No image generation connection configured"}
                aria-label="Generate banner image"
                aria-busy={publicProfileBannerGenerating}
              >
                {publicProfileBannerGenerating ? (
                  <Loader2 size="0.875rem" className="animate-spin" />
                ) : (
                  <Wand2 size="0.875rem" />
                )}
              </button>
            </div>
            <input
              value={publicProfile.bannerImage ?? ""}
              onChange={(event) => updatePublicProfile({ bannerImage: event.target.value })}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
              placeholder="https://..."
            />
          </label>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor={creatorNotesId}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]"
          >
            Creator Notes{" "}
            <HelpTooltip text="Private notes about this character - tips for use, known quirks, recommended settings. Not sent to the AI." />
          </label>
          <div className="flex items-center gap-1">
            <CharacterFieldGenerationButton
              field="creator_notes"
              data={formData}
              comment={characterComment}
              onApply={(value) => typeof value === "string" && updateField("creator_notes", value)}
            />
            <button
              type="button"
              onClick={() => setExpandedCreatorNotes(true)}
              className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              title="Expand editor"
            >
              <Maximize2 size="0.875rem" />
            </button>
          </div>
        </div>
        <textarea
          id={creatorNotesId}
          value={formData.creator_notes}
          onChange={(event) => updateField("creator_notes", event.target.value)}
          rows={4}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3 text-sm outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
          placeholder="Notes about this character, intended use, tips for best results..."
        />
      </div>

      <ExpandedTextarea
        open={expandedCreatorNotes}
        onClose={() => setExpandedCreatorNotes(false)}
        title="Creator Notes"
        value={formData.creator_notes}
        onChange={(value) => updateField("creator_notes", value)}
        placeholder="Notes about this character, intended use, tips for best results..."
      />
    </div>
  );
}
