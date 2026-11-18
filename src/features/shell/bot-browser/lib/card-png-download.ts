import { userFacingError } from "../../../../engine/shared/user-facing-error";
import type { CardFields } from "./card-fields";
import { cardJsonForPng, writeCardIntoPng } from "./png-card";
import { redrawPictureAsPng } from "./redraw-png";
import { fetchBotBrowserAssetBlob } from "./site-api";

/**
 * A SillyTavern card PNG of what the screen shows: the card's picture redrawn as PNG with the card JSON in a
 * `chara` text chunk. A missing picture or one that won't load fails with "Failed to load avatar image".
 */
export async function buildCharacterPng(fields: CardFields, picture: string | null): Promise<Blob> {
  let png: Uint8Array;
  try {
    if (!picture) throw new Error("The character has no picture.");
    png = await redrawPictureAsPng(await fetchBotBrowserAssetBlob(picture));
  } catch (error) {
    console.warn("[bot-browser] The character's picture didn't load for the PNG.", error);
    throw userFacingError("Failed to load avatar image");
  }
  return new Blob([writeCardIntoPng(png, cardJsonForPng(fields))], { type: "image/png" });
}
