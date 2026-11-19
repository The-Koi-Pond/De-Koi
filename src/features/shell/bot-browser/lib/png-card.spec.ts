// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { parsePngCharacterCard } from "../../../../shared/lib/png-parser";
import { tinyPngBytes } from "../test-fixtures/screen-driver";
import { buildCardFields } from "./card-fields";
import { cardJsonForPng, pngFileName, writeCardIntoPng } from "./png-card";
import type { BrowserCard } from "./providers/types";

const card: BrowserCard = {
  id: "abc",
  name: "Zoë of the Reeds",
  creator: "marsh",
  tagline: "",
  tags: ["River", "Calm"],
  picture: "tauri-api:/bot-browser/janny/avatar/a.webp",
  stats: [],
  nsfw: false,
  link: "",
  raw: {},
};

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunks(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const found: Array<{ type: string; crcOk: boolean }> = [];
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const crc = view.getUint32(offset + 8 + length);
    found.push({ type, crcOk: crc === crc32(png.subarray(offset + 4, offset + 8 + length)) });
    offset += 12 + length;
  }
  return found;
}

describe("PNG card writer", () => {
  it("writes a card that opens as a SillyTavern card, with the lorebook when it has entries (decision 2)", async () => {
    const lorebook = { entries: [{ keys: ["reed"], content: "Bends in wind." }] };
    const fields = buildCardFields("janny", card, {
      description: "Quiet.",
      firstMessage: "Hello there — welcome.",
      alternateGreetings: ["Again."],
      embeddedLorebook: lorebook,
    });
    const png = writeCardIntoPng(tinyPngBytes(), cardJsonForPng(fields));

    expect(chunks(png).map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "tEXt", "IEND"]);
    expect(chunks(png).every((chunk) => chunk.crcOk)).toBe(true);

    const { json } = await parsePngCharacterCard(new File([png], "card.png", { type: "image/png" }));
    expect(json).toEqual({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Zoë of the Reeds",
        description: "Quiet.",
        personality: "",
        scenario: "",
        first_mes: "Hello there — welcome.",
        mes_example: "",
        creator_notes: "",
        system_prompt: "",
        post_history_instructions: "",
        tags: ["River", "Calm"],
        creator: "marsh",
        character_version: "",
        alternate_greetings: ["Again."],
        extensions: { janny: { id: "abc" } },
        character_book: lorebook,
      },
    });
  });

  it("leaves an empty lorebook out and fills missing fields with empty values", () => {
    const fields = buildCardFields("wyvern", card, { embeddedLorebook: { entries: [] } });
    const json = cardJsonForPng(fields);
    expect(json.data).not.toHaveProperty("character_book");
    expect(json.data.description).toBe("");
    expect(json.data.alternate_greetings).toEqual([]);
  });

  it("refuses bytes that aren't a PNG", () => {
    expect(() => writeCardIntoPng(new Uint8Array([1, 2, 3]), {})).toThrow("The picture isn't a PNG.");
  });

  it("names the file after the character", () => {
    expect(pngFileName("Zoë of the Reeds")).toBe("Zo__of_the_Reeds.png");
    expect(pngFileName("")).toBe("character.png");
  });
});
