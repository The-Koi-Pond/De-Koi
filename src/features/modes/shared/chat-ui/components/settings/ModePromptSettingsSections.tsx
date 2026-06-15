import { Feather, Maximize2, Sparkles } from "lucide-react";

import { ExpandedTextarea } from "../../../../../../shared/components/ui/ExpandedTextarea";
import type { ChatSettingsMetadataPatch } from "../../lib/chat-settings-actions";
import { buildModePromptMetadataPatch } from "../../lib/chat-settings-actions";
import { ChatSettingsSection as Section } from "./ChatSettingsSections";

export function ModePromptSettingsSections({
  isRoleplayMode,
  isGame,
  sceneSystemPrompt,
  narratorStyleDraft,
  narratorStyleInstructions,
  narratorStyleExpanded,
  extraPromptDraft,
  gameExtraPrompt,
  extraPromptExpanded,
  scenePromptDraft,
  scenePromptExpanded,
  onNarratorStyleDraftChange,
  onNarratorStyleExpandedChange,
  onExtraPromptDraftChange,
  onExtraPromptExpandedChange,
  onScenePromptDraftChange,
  onScenePromptExpandedChange,
  onMetadataPatch,
}: {
  isRoleplayMode: boolean;
  isGame: boolean;
  sceneSystemPrompt: string;
  narratorStyleDraft: string;
  narratorStyleInstructions: string;
  narratorStyleExpanded: boolean;
  extraPromptDraft: string;
  gameExtraPrompt: string;
  extraPromptExpanded: boolean;
  scenePromptDraft: string;
  scenePromptExpanded: boolean;
  onNarratorStyleDraftChange: (value: string) => void;
  onNarratorStyleExpandedChange: (expanded: boolean) => void;
  onExtraPromptDraftChange: (value: string) => void;
  onExtraPromptExpandedChange: (expanded: boolean) => void;
  onScenePromptDraftChange: (value: string) => void;
  onScenePromptExpandedChange: (expanded: boolean) => void;
  onMetadataPatch: (patch: ChatSettingsMetadataPatch) => void;
}) {
  const commitModePrompt = (patch: ChatSettingsMetadataPatch | null) => {
    if (patch) onMetadataPatch(patch);
  };

  return (
    <>
      {isRoleplayMode && (
        <Section
          label="Narrator Style"
          icon={<Feather size="0.875rem" />}
          help="Optional per-chat instructions for the narration voice. This steers descriptive prose without creating an agent, changing character cards, or affecting Game Master behavior."
        >
          <div className="space-y-1.5">
            <div className="relative">
              <textarea
                value={narratorStyleDraft}
                maxLength={2000}
                onChange={(event) => onNarratorStyleDraftChange(event.target.value)}
                onBlur={() =>
                  commitModePrompt(
                    buildModePromptMetadataPatch({
                      field: "narratorStyleInstructions",
                      draft: narratorStyleDraft,
                      stored: narratorStyleInstructions,
                    }),
                  )
                }
                placeholder="e.g. Dry, theatrical, a little sardonic. Describe scenes with lush sensory detail but keep dialogue natural."
                rows={4}
                className="w-full resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 pr-8 text-xs leading-relaxed outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
              />
              <button
                onClick={() => onNarratorStyleExpandedChange(true)}
                className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                title="Expand editor"
              >
                <Maximize2 size="0.75rem" />
              </button>
            </div>
            <p className="px-0.5 text-[0.5625rem] text-[var(--muted-foreground)]/70">
              {narratorStyleDraft ? `${narratorStyleDraft.length}/2000 characters` : "No narrator style set"}
            </p>
            {narratorStyleDraft && (
              <button
                onClick={() => {
                  onNarratorStyleDraftChange("");
                  onMetadataPatch({ narratorStyleInstructions: null });
                }}
                className="rounded-lg bg-[var(--secondary)] px-2.5 py-1 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]"
              >
                Clear
              </button>
            )}
          </div>
          <ExpandedTextarea
            open={narratorStyleExpanded}
            onClose={() => {
              onNarratorStyleExpandedChange(false);
              commitModePrompt(
                buildModePromptMetadataPatch({
                  field: "narratorStyleInstructions",
                  draft: narratorStyleDraft,
                  stored: narratorStyleInstructions,
                }),
              );
            }}
            title="Narrator Style"
            value={narratorStyleDraft}
            onChange={(value) => onNarratorStyleDraftChange(value.slice(0, 2000))}
            placeholder="Optional narration voice and descriptive prose guidance for this roleplay chat..."
          />
        </Section>
      )}

      {isGame && (
        <Section
          label="Extra Prompt"
          icon={<Feather size="0.875rem" />}
          help="Additional instructions added to game generation prompts. Use this to suggest a writing style, ban themes, request specific behaviors, etc. Does not affect scene analysis."
        >
          <div className="space-y-1.5">
            <div className="relative">
              <textarea
                value={extraPromptDraft}
                onChange={(event) => onExtraPromptDraftChange(event.target.value)}
                onBlur={() =>
                  commitModePrompt(
                    buildModePromptMetadataPatch({
                      field: "gameExtraPrompt",
                      draft: extraPromptDraft,
                      stored: gameExtraPrompt,
                    }),
                  )
                }
                placeholder="e.g. Write in a poetic, literary style. Avoid graphic violence. Always describe the weather..."
                rows={5}
                className="w-full resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 pr-8 text-xs leading-relaxed outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
              />
              <button
                onClick={() => onExtraPromptExpandedChange(true)}
                className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                title="Expand editor"
              >
                <Maximize2 size="0.75rem" />
              </button>
            </div>
            <p className="text-[0.5625rem] text-[var(--muted-foreground)]/70 px-0.5">
              {extraPromptDraft ? "Custom instructions active" : "No extra instructions set"}
            </p>
            {extraPromptDraft && (
              <button
                onClick={() => {
                  onExtraPromptDraftChange("");
                  onMetadataPatch({ gameExtraPrompt: null });
                }}
                className="rounded-lg bg-[var(--secondary)] px-2.5 py-1 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]"
              >
                Clear
              </button>
            )}
          </div>
          <ExpandedTextarea
            open={extraPromptExpanded}
            onClose={() => {
              onExtraPromptExpandedChange(false);
              commitModePrompt(
                buildModePromptMetadataPatch({
                  field: "gameExtraPrompt",
                  draft: extraPromptDraft,
                  stored: gameExtraPrompt,
                }),
              );
            }}
            title="Extra Prompt"
            value={extraPromptDraft}
            onChange={onExtraPromptDraftChange}
            placeholder="Additional instructions for game generation..."
          />
        </Section>
      )}

      {sceneSystemPrompt && (
        <Section
          label="Scene Instructions"
          icon={<Sparkles size="0.875rem" />}
          help="The system prompt generated for this scene. You can edit it to change the AI's writing style, POV, tone, and focus."
        >
          <div className="relative">
            <textarea
              value={scenePromptDraft}
              onChange={(event) => onScenePromptDraftChange(event.target.value)}
              onBlur={() =>
                commitModePrompt(
                  buildModePromptMetadataPatch({
                    field: "sceneSystemPrompt",
                    draft: scenePromptDraft,
                    stored: sceneSystemPrompt,
                  }),
                )
              }
              placeholder="Scene system prompt..."
              rows={6}
              className="w-full resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 pr-8 text-xs leading-relaxed outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
            />
            <button
              onClick={() => onScenePromptExpandedChange(true)}
              className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              title="Expand editor"
            >
              <Maximize2 size="0.75rem" />
            </button>
          </div>
          <ExpandedTextarea
            open={scenePromptExpanded}
            onClose={() => {
              onScenePromptExpandedChange(false);
              commitModePrompt(
                buildModePromptMetadataPatch({
                  field: "sceneSystemPrompt",
                  draft: scenePromptDraft,
                  stored: sceneSystemPrompt,
                }),
              );
            }}
            title="Scene Instructions"
            value={scenePromptDraft}
            onChange={onScenePromptDraftChange}
            placeholder="Scene system prompt..."
          />
        </Section>
      )}
    </>
  );
}
