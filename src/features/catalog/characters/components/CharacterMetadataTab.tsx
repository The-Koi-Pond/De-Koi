import { useState } from "react";
import { AlertCircle, Loader2, Maximize2, Tag, Wand2, X } from "lucide-react";

import type { CharacterData, CharacterPublicProfile } from "../../../../engine/contracts/types/character";
import { generateCharacterPublicProfileBio } from "../../../../engine/generation/public-profile";
import { AvatarCropWidget } from "../../../../shared/components/ui/AvatarCropWidget";
import { ExpandedTextarea } from "../../../../shared/components/ui/ExpandedTextarea";
import { HelpTooltip } from "../../../../shared/components/ui/HelpTooltip";
import { llmApi } from "../../../../shared/api/llm-api";
import type { AvatarCrop } from "../../../../shared/lib/utils";
import { CharacterEditorSectionHeader as SectionHeader } from "./CharacterEditorSectionHeader";
import { CharacterVersionHistoryPanel } from "./CharacterVersionHistoryPanel";
import { useConnections } from "../../connections/index";

function readPublicProfile(value: unknown): CharacterPublicProfile {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as CharacterPublicProfile) : {};
}

function parsePublicTagsInput(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of value.split(",")) {
    const tag = part.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
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
}) {
  const [expandedCreatorNotes, setExpandedCreatorNotes] = useState(false);
  const [generatingPublicBio, setGeneratingPublicBio] = useState(false);
  const [publicBioError, setPublicBioError] = useState<string | null>(null);
  const [publicBioConnectionId, setPublicBioConnectionId] = useState("");
  const { data: rawConnections } = useConnections();
  const creatorNotesId = "character-creator-notes";
  // Read the saved source-rectangle crop and write the same current shape on edit.
  const savedCrop = (formData.extensions.avatarCrop as AvatarCrop | undefined) ?? null;
  const talkativeness = typeof formData.extensions.talkativeness === "number" ? formData.extensions.talkativeness : 0.5;
  const publicProfile = readPublicProfile(formData.extensions.publicProfile);
  const connections = rawConnections ?? [];
  const selectedPublicBioConnectionId = publicBioConnectionId || connections[0]?.id || "";
  const updatePublicProfile = (patch: CharacterPublicProfile) =>
    updateExtension("publicProfile", { ...publicProfile, ...patch });

  const handleGeneratePublicBio = async () => {
    if (!selectedPublicBioConnectionId || generatingPublicBio) return;
    setGeneratingPublicBio(true);
    setPublicBioError(null);
    try {
      const bio = await generateCharacterPublicProfileBio(
        { llm: llmApi },
        {
          connectionId: selectedPublicBioConnectionId,
          character: formData,
          comment: characterComment,
          existingProfile: publicProfile,
        },
      );
      updatePublicProfile({ bio });
    } catch (error) {
      setPublicBioError(error instanceof Error ? error.message : "Profile bio generation failed.");
    } finally {
      setGeneratingPublicBio(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeader title="Metadata" subtitle="Basic character info — name, creator, version, tags." />

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
            placeholder="Add tag…"
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeader title="Public Profile" subtitle="Outward-facing identity used by quick inspect cards." />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {connections.length > 1 && (
              <select
                value={selectedPublicBioConnectionId}
                onChange={(event) => setPublicBioConnectionId(event.target.value)}
                className="max-w-44 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
                aria-label="Profile bio model connection"
              >
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={handleGeneratePublicBio}
              disabled={generatingPublicBio || !selectedPublicBioConnectionId}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              title={selectedPublicBioConnectionId ? "Generate public bio" : "Add a model connection to generate a bio"}
            >
              {generatingPublicBio ? <Loader2 size="0.75rem" className="animate-spin" /> : <Wand2 size="0.75rem" />}
              Generate bio
            </button>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
              Display Name{" "}
              <HelpTooltip text="Optional name for profile previews. Chat still uses the character name above." />
            </span>
            <input
              value={publicProfile.displayName ?? ""}
              onChange={(event) => updatePublicProfile({ displayName: event.target.value })}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
              placeholder={formData.name}
            />
          </label>
          <label className="space-y-1.5">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
              Handle <HelpTooltip text="Optional short username shown on profile previews." />
            </span>
            <input
              value={publicProfile.handle ?? ""}
              onChange={(event) => updatePublicProfile({ handle: event.target.value })}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
              placeholder="@username"
            />
          </label>
        </div>
        <label className="space-y-1.5 block">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Bio <HelpTooltip text="Short public blurb for profile previews." />
          </span>
          <textarea
            value={publicProfile.bio ?? ""}
            onChange={(event) => updatePublicProfile({ bio: event.target.value })}
            rows={3}
            className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-sm outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            placeholder="A short outward-facing intro..."
          />
        </label>
        {publicBioError && (
          <p className="flex items-start gap-1.5 rounded-lg border border-[var(--destructive)]/25 bg-[var(--destructive)]/5 px-2.5 py-2 text-xs text-[var(--destructive)]">
            <AlertCircle size="0.75rem" className="mt-0.5 shrink-0" />
            {publicBioError}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
              Public Tags{" "}
              <HelpTooltip text="Comma-separated tags shown on profile previews. Falls back to card tags when blank." />
            </span>
            <input
              value={(publicProfile.tags ?? []).join(", ")}
              onChange={(event) => updatePublicProfile({ tags: parsePublicTagsInput(event.target.value) })}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
              placeholder="friendly, mysterious"
            />
          </label>
          <label className="space-y-1.5">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
              Banner Image <HelpTooltip text="Optional image URL for profile previews." />
            </span>
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
            <HelpTooltip text="Private notes about this character — tips for use, known quirks, recommended settings. Not sent to the AI." />
          </label>
          <button
            type="button"
            onClick={() => setExpandedCreatorNotes(true)}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Expand editor"
          >
            <Maximize2 size="0.875rem" />
          </button>
        </div>
        <textarea
          id={creatorNotesId}
          value={formData.creator_notes}
          onChange={(event) => updateField("creator_notes", event.target.value)}
          rows={4}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3 text-sm outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
          placeholder="Notes about this character, intended use, tips for best results…"
        />
      </div>

      <ExpandedTextarea
        open={expandedCreatorNotes}
        onClose={() => setExpandedCreatorNotes(false)}
        title="Creator Notes"
        value={formData.creator_notes}
        onChange={(value) => updateField("creator_notes", value)}
        placeholder="Notes about this character, intended use, tips for best results…"
      />
    </div>
  );
}
