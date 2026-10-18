// Talks to a running de-koi-server through its HTTP invoke API.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEMO_BACKGROUND, DEMO_CHARACTERS, DEMO_CONNECTION, DEMO_PERSONA } from "./cast.mjs";

export const DEMO_ART_DIR = "docs/screenshots/demo";

export function runtimeClient(baseUrl) {
  return async function invoke(command, args = {}) {
    const response = await fetch(`${baseUrl}/api/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl, "x-marinara-csrf": "1" },
      body: JSON.stringify({ command, args }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${command} failed (${response.status}): ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : null;
  };
}

async function artDataUrl(file) {
  const bytes = await readFile(path.join(DEMO_ART_DIR, file));
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

async function artUpload(file) {
  const bytes = await readFile(path.join(DEMO_ART_DIR, file));
  return { name: file, type: "image/jpeg", size: bytes.length, lastModified: 0, base64: bytes.toString("base64") };
}

/** Seeds the connection, persona, characters (with portraits) and the roleplay background. Returns character ids by key. */
export async function seedCast(invoke) {
  await invoke("storage_create", { entity: "connections", value: DEMO_CONNECTION });

  const { avatar: personaAvatar, ...persona } = DEMO_PERSONA;
  await invoke("storage_create", {
    entity: "personas",
    value: {
      ...persona,
      personality: "",
      scenario: "",
      backstory: "",
      appearance: "",
      avatarPath: null,
      isActive: true,
    },
  });
  await invoke("persona_avatar_upload", {
    id: persona.id,
    body: { avatar: await artDataUrl(personaAvatar), filename: personaAvatar },
  });
  await invoke("persona_activate", { id: persona.id });

  const ids = {};
  for (const character of DEMO_CHARACTERS) {
    const result = await invoke("import_st_character", {
      body: { spec: "chara_card_v2", spec_version: "2.0", data: { ...character.card, creator: "De-Koi demo" } },
    });
    const id = result?.id ?? result?.character?.id ?? result?.data?.id;
    if (!id)
      throw new Error(
        `Character import returned no id for ${character.card.name}: ${JSON.stringify(result).slice(0, 300)}`,
      );
    await invoke("character_avatar_upload", { id, body: { avatar: await artDataUrl(character.avatar) } });
    ids[character.key] = id;
  }

  await invoke("background_upload", { body: { file: await artUpload(DEMO_BACKGROUND.file) } });
  return ids;
}

/** Seeds the saved demo chats with their original ids (fanfic metadata refers to them). Messages keep their recorded
 * spacing and end a few minutes before `now`. */
export async function seedChats(invoke, chats, characterIds, now = Date.now()) {
  const chatIds = {};
  for (const [index, chat] of chats.entries()) {
    const id = chat.id;
    // Keep the recorded gaps between messages, but never let two share a timestamp (that would scramble the order).
    const offsets = [];
    for (const message of chat.messages) {
      const previous = offsets.at(-1) ?? -1;
      offsets.push(Math.max(message.secondsIn * 1000, previous + 1000));
    }
    const span = Math.max(0, ...offsets);
    const start = now - span - (5 + index * 3) * 60000;
    const at = (offsetMs) => new Date(start + offsetMs).toISOString();
    await invoke("storage_create", {
      entity: "chats",
      value: {
        id,
        name: chat.name,
        mode: chat.mode,
        characterIds: chat.characters.map((key) => characterIds[key]),
        personaId: chat.personaId,
        promptPresetId: chat.promptPresetId,
        connectionId: "demo-claude",
        groupId: null,
        metadata: chat.metadata,
        createdAt: at(0),
        updatedAt: at(span),
      },
    });
    for (const [position, message] of chat.messages.entries()) {
      const swipes = message.swipes ?? [message.content];
      await invoke("storage_create", {
        entity: "messages",
        value: {
          id: message.id,
          chatId: id,
          role: message.role,
          characterId: message.character ? characterIds[message.character] : null,
          content: message.content,
          swipes: swipes.map((content) => ({ content })),
          activeSwipeIndex: message.activeSwipeIndex ?? 0,
          createdAt: at(offsets[position]),
          extra: {},
        },
      });
    }
    chatIds[chat.name] = id;
  }
  return chatIds;
}
