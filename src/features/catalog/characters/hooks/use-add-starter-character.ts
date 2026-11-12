// ──────────────────────────────────────────────
// Hook: add a ready-made starter character, with its bundled art
// ──────────────────────────────────────────────
import { useCallback } from "react";
import type { StarterCharacter, StarterStaging } from "../../../../engine/modes/roleplay/starter-characters";
import { useUploadSprites, type SpriteUploadItem } from "../../sprites/index";
import { starterCharacterCreateInput } from "../lib/blank-character-card";
import { useCreateCharacter, useUploadAvatar } from "./use-characters";

export interface AddedStarterCharacter {
  id: string;
  /** Set when the card was made but its bundled pictures could not be saved. */
  artError: unknown;
}

/** Address of a file bundled under the app's public folder. */
export function starterStagingAssetUrl(staging: StarterStaging, file: string): string {
  return `${import.meta.env.BASE_URL}${staging.folder}/${file}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read a bundled picture."));
    reader.readAsDataURL(blob);
  });
}

async function bundledPicture(staging: StarterStaging, file: string): Promise<string> {
  const url = starterStagingAssetUrl(staging, file);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load the bundled picture ${file} (HTTP ${response.status}).`);
  return blobToDataUrl(await response.blob());
}

export function useAddStarterCharacter() {
  const createCharacter = useCreateCharacter();
  const uploadAvatar = useUploadAvatar();
  const uploadSprites = useUploadSprites();
  const { mutateAsync: create } = createCharacter;
  const { mutateAsync: saveAvatar } = uploadAvatar;
  const { mutateAsync: saveSprites } = uploadSprites;

  const saveArt = useCallback(
    async (characterId: string, staging: StarterStaging) => {
      const avatar = await bundledPicture(staging, staging.avatar);
      const sprites: SpriteUploadItem[] = await Promise.all(
        Object.entries(staging.sprites).map(async ([expression, file]) => ({
          expression,
          image: await bundledPicture(staging, file),
        })),
      );
      await saveAvatar({ id: characterId, avatar });
      const result = await saveSprites({ characterId, sprites });
      if (result.failed.length > 0) {
        const first = result.failed[0]!;
        throw new Error(`${result.failed.length} sprite(s) couldn't be saved (${first.expression}: ${first.error}).`);
      }
    },
    [saveAvatar, saveSprites],
  );

  const add = useCallback(
    async (starter: StarterCharacter): Promise<AddedStarterCharacter> => {
      const result = await create(starterCharacterCreateInput(starter));
      const id = (result as { id?: string } | undefined)?.id;
      if (!id) throw new Error("The new character came back without an id.");
      if (!starter.staging) return { id, artError: null };
      try {
        await saveArt(id, starter.staging);
        return { id, artError: null };
      } catch (error) {
        return { id, artError: error };
      }
    },
    [create, saveArt],
  );

  return { add, isPending: createCharacter.isPending || uploadAvatar.isPending || uploadSprites.isPending };
}
