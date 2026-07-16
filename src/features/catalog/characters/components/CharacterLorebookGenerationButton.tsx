import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import {
  createLorebookEntrySchema,
  lorebookCategorySchema,
} from "../../../../engine/contracts/schemas/lorebook.schema";
import type { CharacterData } from "../../../../engine/contracts/types/character";
import type { Lorebook, LorebookScope } from "../../../../engine/contracts/types/lorebook";
import { generateLorebookMaker } from "../../../../engine/generation/makers";
import { connectionCatalogApi } from "../../../../shared/api/connection-catalog-api";
import { llmApi } from "../../../../shared/api/llm-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { DekiWorkingWindow } from "../../../../shared/components/ui/DekiWorkingWindow";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { lorebookKeys, useCreateLorebook } from "../../lorebooks/index";
import { characterKeys } from "../hooks/use-characters";
import { buildCharacterLorebookPrompt, characterLorebookName } from "../lib/character-lorebook-generation";

type GeneratedLorebook = {
  lorebook_name?: string;
  lorebook_description?: string;
  category?: string;
  entries?: Array<{
    name?: string;
    content?: string;
    keys?: string[];
    secondary_keys?: string[];
    secondaryKeys?: string[];
    tag?: string;
    constant?: boolean;
    order?: number;
  }>;
};

type CharacterLorebookGenerationButtonProps = {
  characterId: string | null;
  data: CharacterData;
};

const DEFAULT_CHARACTER_LOREBOOK_SCOPE: LorebookScope = { mode: "all", chatIds: [] };

function parseGeneratedLorebook(raw: string): GeneratedLorebook | null {
  try {
    const parsed = JSON.parse(raw) as GeneratedLorebook;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeGeneratedCategory(category: unknown) {
  const parsed = lorebookCategorySchema.safeParse(category);
  return parsed.success ? parsed.data : "character";
}

export function CharacterLorebookGenerationButton({ characterId, data }: CharacterLorebookGenerationButtonProps) {
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const createLorebook = useCreateLorebook();
  const openLorebookDetail = useUIStore((state) => state.openLorebookDetail);
  const queryClient = useQueryClient();

  const handleGenerate = async () => {
    if (!characterId || generating) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setGenerating(true);

    try {
      const connectionId = await connectionCatalogApi.resolveDefaultTextConnectionId();
      let generated: GeneratedLorebook | null = null;

      for await (const event of generateLorebookMaker(
        { llm: llmApi, storage: storageApi },
        {
          prompt: buildCharacterLorebookPrompt(data),
          connectionId,
          entryCount: 10,
          streaming: false,
        },
        abort.signal,
      )) {
        if (event.type === "done") generated = parseGeneratedLorebook(event.data);
        if (event.type === "error") throw new Error(event.data);
      }

      const entries = generated?.entries ?? [];
      if (!generated || entries.length === 0) {
        throw new Error("Provider did not return valid lorebook entries.");
      }

      const lorebook = await createLorebook.mutateAsync({
        name: generated.lorebook_name?.trim() || characterLorebookName(data),
        description:
          generated.lorebook_description?.trim() || `Generated lorebook for ${data.name || "this character"}.`,
        category: normalizeGeneratedCategory(generated.category),
        characterId: null,
        characterIds: [characterId],
        scope: DEFAULT_CHARACTER_LOREBOOK_SCOPE,
        generatedBy: "lorebook-maker",
      });
      const lorebookId = (lorebook as Lorebook).id;

      const validatedEntries = entries.map((entry, index) =>
        createLorebookEntrySchema.parse({
          lorebookId,
          name: entry.name ?? "Untitled",
          content: entry.content ?? "",
          keys: entry.keys ?? [],
          secondaryKeys: [...(entry.secondary_keys ?? []), ...(entry.secondaryKeys ?? [])],
          tag: entry.tag ?? "",
          constant: entry.constant ?? false,
          order: entry.order ?? (index + 1) * 100,
        }),
      );
      await Promise.all(validatedEntries.map((entry) => storageApi.create("lorebook-entries", entry)));

      await queryClient.invalidateQueries({ queryKey: lorebookKeys.all });
      await queryClient.invalidateQueries({ queryKey: lorebookKeys.entries(lorebookId) });
      await queryClient.invalidateQueries({ queryKey: characterKeys.all });
      await queryClient.invalidateQueries({ queryKey: characterKeys.detail(characterId) });

      toast.success(`Created ${validatedEntries.length} lorebook entries.`);
      openLorebookDetail(lorebookId);
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        toast.error(error instanceof Error ? error.message : "Failed to generate lorebook.");
      }
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null;
        setGenerating(false);
      }
    }
  };

  return (
    <>
      <DekiWorkingWindow visible={generating} />
      <button
        type="button"
        onClick={handleGenerate}
        disabled={!characterId || generating}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/15 px-3 py-1.5 text-xs font-medium text-amber-500 transition-colors hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-50"
        title="Generate lorebook"
        aria-label="Generate lorebook"
        aria-busy={generating}
      >
        {generating ? <Loader2 size="0.75rem" className="animate-spin" /> : <Wand2 size="0.75rem" />}
        Generate
      </button>
    </>
  );
}
