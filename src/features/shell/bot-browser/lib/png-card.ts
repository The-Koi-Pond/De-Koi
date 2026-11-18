import type { CardFields } from "./card-fields";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** The PNG chunk CRC (CRC-32 over the chunk type and data). */
function crc32(bytes: Uint8Array): number {
  const lookup = table();
  let crc = 0xffffffff;
  for (const byte of bytes) crc = lookup[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function latin1Bytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
  return bytes;
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function textChunk(keyword: string, value: string): Uint8Array {
  const data = latin1Bytes(`${keyword}\0${value}`);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(latin1Bytes("tEXt"), 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** The SillyTavern V2 card a downloaded PNG carries. The lorebook goes in only when it has entries (decision 2). */
export function cardJsonForPng(fields: CardFields) {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: fields.name ?? "",
      description: fields.description ?? "",
      personality: fields.personality ?? "",
      scenario: fields.scenario ?? "",
      first_mes: fields.first_mes ?? "",
      mes_example: fields.mes_example ?? "",
      creator_notes: fields.creator_notes ?? "",
      system_prompt: fields.system_prompt ?? "",
      post_history_instructions: fields.post_history_instructions ?? "",
      tags: fields.tags ?? [],
      creator: fields.creator ?? "",
      character_version: fields.character_version ?? "",
      alternate_greetings: fields.alternate_greetings ?? [],
      extensions: fields.extensions ?? {},
      ...(fields.character_book !== undefined ? { character_book: fields.character_book } : {}),
    },
  };
}

/** Adds a `chara` tEXt chunk (base64 of the card's UTF-8 JSON) just before IEND. */
export function writeCardIntoPng(png: Uint8Array, card: unknown): Uint8Array<ArrayBuffer> {
  if (png.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, index) => png[index] !== byte)) {
    throw new Error("The picture isn't a PNG.");
  }
  let offset = PNG_SIGNATURE.length;
  let iendOffset = -1;
  while (offset + 8 <= png.length) {
    const length = readUint32(png, offset);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    if (type === "IEND") {
      iendOffset = offset;
      break;
    }
    offset += 12 + length;
  }
  if (iendOffset === -1) throw new Error("The picture's PNG data has no end.");

  const chunk = textChunk("chara", utf8Base64(JSON.stringify(card)));
  const result = new Uint8Array(png.length + chunk.length);
  result.set(png.subarray(0, iendOffset), 0);
  result.set(chunk, iendOffset);
  result.set(png.subarray(iendOffset), iendOffset + chunk.length);
  return result;
}

/** The saved file's name: every character but letters, digits, `_` and `-` becomes `_`. */
export function pngFileName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, "_");
  return safe ? `${safe}.png` : "character.png";
}
